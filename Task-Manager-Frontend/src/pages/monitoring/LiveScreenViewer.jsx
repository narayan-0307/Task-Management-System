import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MonitorOff, Loader2, Wifi, Minimize2, Maximize2, Camera, Download } from "lucide-react";
import { getSocket } from "../../lib/socket.js";

// Live Screen viewer.
//
// The employer sees the employee's screen live over a peer-to-peer WebRTC
// connection. The agent is the OFFERER (it owns the screen capture); this
// component is the ANSWERER. Nothing is recorded: the MediaStream is attached
// straight to a <video> element and is dropped when the modal closes.
//
// Signaling rides the existing socket.io connection:
//   emit  livescreen:request {targetUserId}  -> ack {ok, sessionId, iceServers}
//   emit  livescreen:answer  {sessionId, sdp}
//   emit  livescreen:ice     {sessionId, candidate}
//   emit  livescreen:stop    {sessionId}
//   on    livescreen:offer / livescreen:ice / livescreen:status / livescreen:ended
//
// Screenshot: a still frame grabbed from the <video> element ITSELF, entirely
// client-side — no new session, endpoint, or authorization path. It reuses
// whatever Live Screen session is already open, so the existing gate (who may
// open Live Screen at all) is the only gate that applies here too. The frame
// becomes a blob: object URL held only in this component's state; nothing is
// ever sent to the server. Closing the screenshot, closing/reopening the
// viewer, or navigating/refreshing the page all drop the reference (the last
// two also let the browser's normal teardown revoke the object URL), and this
// component explicitly revokes it too so nothing lingers in memory.

const REQUEST_ERRORS = {
  not_enabled: "Live Screen is not enabled for this organization yet.",
  not_authorized: "You are not authorized to view this employee's screen.",
  consent_missing: "The employee has not yet accepted the live-screen notice.",
  agent_offline: "The employee's agent is offline.",
  bad_request: "Could not start the session.",
  unauthenticated: "Your session is missing organization context — sign in again.",
  not_ready:
    "Live Screen isn't set up on the server (database migrations not applied). Ask an admin to run the pending migrations.",
  server_error: "Server error starting the session.",
};
const END_REASONS = {
  stopped_by_viewer: "Session ended.",
  stopped_by_employee: "The employee ended the session.",
  viewer_disconnected: "Disconnected.",
  agent_unavailable: "The agent did not respond — it may be offline.",
  agent_shutdown: "The employee's agent stopped.",
  timeout: "The session timed out.",
  max_duration: "The session reached its maximum length.",
  superseded: "A newer session replaced this one.",
  connect_failed:
    "Couldn't establish the connection. This network likely needs a TURN server — set LIVE_SCREEN_ICE_SERVERS.",
  not_enabled: "Live Screen was turned off.",
  error: "The session ended on an error.",
};

// Shown when the peer connection fails on the viewer side (STUN-only can't
// cross a symmetric NAT / strict firewall).
const NO_CONNECTION_HINT =
  "Couldn't reach the employee's screen. Direct (STUN-only) connections fail on many corporate and mobile networks — add a TURN server via LIVE_SCREEN_ICE_SERVERS.";

// How long the viewer waits for the peer connection before giving up. Slightly
// longer than the agent's and the server's own timeouts.
const VIEWER_CONNECT_TIMEOUT_MS = 50 * 1000;

// A filesystem-safe, informative name for the downloaded PNG. Client-side
// only — this never touches the network.
function screenshotFilename(employeeName, when) {
  const safeName =
    String(employeeName || "employee")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "employee";
  const ts = when.toISOString().replace(/[:.]/g, "-");
  return `live-screen-${safeName}-${ts}.png`;
}

export default function LiveScreenViewer({ open, targetUserId, employeeName, onClose }) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const sessionIdRef = useRef(null);
  const connectTimerRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const [phase, setPhase] = useState("idle"); // idle | requesting | connecting | live | ended | error
  const [message, setMessage] = useState("");
  const [stunOnly, setStunOnly] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // "normal" | "min" | "max" — purely a display state. It never touches `open`,
  // the socket, or the RTCPeerConnection, so minimizing/maximizing cannot
  // disconnect or stop the video/audio. The single <video> element below stays
  // mounted across all three layouts so its srcObject is never dropped.
  const [layout, setLayout] = useState("normal");
  // { url, capturedAt } | null — url is a blob: object URL for one PNG frame,
  // held ONLY here, never uploaded, never written to any storage. See the
  // module-doc comment above for the full memory-lifecycle contract.
  const [screenshot, setScreenshot] = useState(null);
  const screenshotUrlRef = useRef(null); // mirrors screenshot?.url for cleanup

  const clearScreenshot = useCallback(() => {
    if (screenshotUrlRef.current) {
      URL.revokeObjectURL(screenshotUrlRef.current);
      screenshotUrlRef.current = null;
    }
    setScreenshot(null);
  }, []);

  // Grabs the CURRENT frame of the already-playing <video> — no new WebRTC
  // session, no server round-trip. Requires an actual decoded frame to exist
  // (readyState >= HAVE_CURRENT_DATA), which in practice means the stream is
  // live.
  const captureScreenshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
      const url = URL.createObjectURL(blob);
      screenshotUrlRef.current = url;
      setScreenshot({ url, capturedAt: new Date() });
      // A captured frame is meant to be reviewed — restore from the small
      // corner widget so it's actually legible. Does not touch the connection.
      setLayout((l) => (l === "min" ? "normal" : l));
    }, "image/png");
  }, []);

  const teardown = useCallback(
    (notifyServer) => {
      const socket = getSocket();
      const sid = sessionIdRef.current;
      pendingIceCandidatesRef.current = [];
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      if (notifyServer && sid) socket.emit("livescreen:stop", { sessionId: sid });
      sessionIdRef.current = null;
      if (pcRef.current) {
        try {
          pcRef.current.getReceivers().forEach((r) => r.track && r.track.stop());
          pcRef.current.close();
        } catch {
          /* ignore */
        }
        pcRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    },
    [],
  );

  useEffect(() => {
    if (!open) return undefined;
    const socket = getSocket();
    let cancelled = false;

    setPhase("requesting");
    setMessage("");
    setLayout("normal"); // fresh session opens at normal size, never pre-minimized
    pendingIceCandidatesRef.current = [];

    const onOffer = async ({ sessionId, sdp }) => {
      if (cancelled || sessionId !== sessionIdRef.current || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription({ type: "offer", sdp });
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        socket.emit("livescreen:answer", { sessionId, sdp: answer.sdp });

        // Flush any candidates buffered before remoteDescription was set
        if (pendingIceCandidatesRef.current.length > 0) {
          for (const cand of pendingIceCandidatesRef.current) {
            try {
              await pcRef.current.addIceCandidate(cand);
            } catch {
              /* non-fatal */
            }
          }
          pendingIceCandidatesRef.current = [];
        }

        setPhase("connecting");
      } catch (err) {
        setPhase("error");
        setMessage(`Negotiation failed: ${err.message}`);
        teardown(true);
      }
    };
    const onIce = async ({ sessionId, candidate }) => {
      if (sessionId !== sessionIdRef.current || !candidate) return;
      if (!pcRef.current || !pcRef.current.remoteDescription || !pcRef.current.remoteDescription.type) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch {
        /* non-fatal */
      }
    };
    const onStatus = ({ sessionId, status }) => {
      if (sessionId === sessionIdRef.current && status === "live") setPhase("live");
    };
    const onEnded = ({ sessionId, reason }) => {
      if (sessionId !== sessionIdRef.current) return;
      teardown(false);
      setPhase("ended");
      setMessage(END_REASONS[reason] || "Session ended.");
    };

    socket.on("livescreen:offer", onOffer);
    socket.on("livescreen:ice", onIce);
    socket.on("livescreen:status", onStatus);
    socket.on("livescreen:ended", onEnded);

    socket.emit("livescreen:request", { targetUserId }, (ack) => {
      if (cancelled) return;
      if (!ack || !ack.ok) {
        setPhase("error");
        setMessage(
          (ack && ack.detail) ||
            REQUEST_ERRORS[ack && ack.code] ||
            "Could not start the session.",
        );
        return;
      }
      sessionIdRef.current = ack.sessionId;
      const servers = ack.iceServers || [];
      const hasTurn = servers.some((s) =>
        []
          .concat(s.urls || [])
          .some((u) => String(u).startsWith("turn:") || String(u).startsWith("turns:")),
      );
      setStunOnly(!hasTurn);
      const pc = new RTCPeerConnection({ iceServers: servers });
      pcRef.current = pc;
      pc.addEventListener("track", (e) => {
        if (videoRef.current) videoRef.current.srcObject = e.streams[0];
      });
      pc.addEventListener("icecandidate", (e) => {
        if (e.candidate) {
          socket.emit("livescreen:ice", {
            sessionId: ack.sessionId,
            candidate: e.candidate.toJSON(),
          });
        }
      });

      const fail = (msg) => {
        if (cancelled) return;
        setPhase("error");
        setMessage(msg);
        teardown(true);
      };

      const failConnection = () => {
        fail(
          !hasTurn
            ? NO_CONNECTION_HINT
            : "Couldn't reach the employee's screen. Peer connection failed — please check network or firewall settings.",
        );
      };

      pc.addEventListener("connectionstatechange", () => {
        const st = pc.connectionState;
        if (st === "connected") {
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          setPhase("live");
          setMessage("");
        } else if (st === "failed") {
          failConnection();
        } else if (st === "disconnected") {
          // transient — WebRTC may recover; surface it without tearing down yet
          setMessage("Connection interrupted — trying to recover…");
        }
      });
      pc.addEventListener("iceconnectionstatechange", () => {
        if (pc.iceConnectionState === "failed") failConnection();
      });

      // Overall guard: never leave the viewer spinning if nothing ever connects
      // (STUN-only on a strict NAT, lost signaling, backend timer suspended…).
      connectTimerRef.current = setTimeout(() => {
        if (pcRef.current && pcRef.current.connectionState !== "connected") {
          failConnection();
        }
      }, VIEWER_CONNECT_TIMEOUT_MS);

      setPhase("connecting");
    });

    return () => {
      cancelled = true;
      socket.off("livescreen:offer", onOffer);
      socket.off("livescreen:ice", onIce);
      socket.off("livescreen:status", onStatus);
      socket.off("livescreen:ended", onEnded);
      teardown(true);
      // Closing the viewer, retrying, or switching target all end this
      // session boundary — drop any captured screenshot with it.
      clearScreenshot();
    };
  }, [open, targetUserId, teardown, attempt, clearScreenshot]);

  if (!open) return null;

  const canRetry = phase === "error" || phase === "ended";
  const isMin = layout === "min";
  const isMax = layout === "max";

  const statusLine =
    {
      requesting: "Requesting session…",
      connecting: "Connecting…",
      live: "Live",
      ended: message || "Session ended.",
      error: message || "Error.",
    }[phase] || "";

  const dot = (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        phase === "live"
          ? "bg-emerald-500"
          : phase === "error"
            ? "bg-red-500"
            : phase === "ended"
              ? "bg-slate-400"
              : "bg-amber-400"
      }`}
    />
  );

  // Minimize / Maximize are purely visual — they only change these container
  // classes. The <video> element below is never removed from the tree across
  // layouts, so its srcObject (and therefore the live picture) is unaffected;
  // neither button touches `open`, the socket listeners, or the
  // RTCPeerConnection, so they cannot disconnect or stop the video/audio.
  return createPortal(
    <div
      className={
        isMin
          ? "fixed bottom-4 right-4 z-50"
          : "fixed inset-0 z-50 flex items-center justify-center p-4"
      }
    >
      {!isMin && <div className="absolute inset-0 bg-black/70" onClick={onClose} />}
      <div
        className={`relative flex flex-col overflow-hidden rounded-xl border border-hair bg-surface-1 shadow-xl ${
          isMin ? "w-72" : isMax ? "h-[92vh] w-full max-w-[96vw]" : "w-full max-w-5xl"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            {dot}
            <h2 className="truncate font-display text-sm font-semibold text-txt-primary">
              {isMin ? employeeName || "Employee" : `Live Screen — ${employeeName || "Employee"}`}
            </h2>
            {!isMin && <span className="shrink-0 text-xs text-txt-muted">{statusLine}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={captureScreenshot}
              disabled={phase !== "live"}
              className={`rounded-md p-1 ${
                phase === "live"
                  ? "text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
                  : "cursor-not-allowed text-txt-muted/40"
              }`}
              aria-label="Take a screenshot"
              title={phase === "live" ? "Take a screenshot" : "Available once the stream is live"}
            >
              <Camera size={15} />
            </button>
            <button
              onClick={() => setLayout(isMin ? "normal" : "min")}
              className="rounded-md p-1 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
              aria-label={isMin ? "Restore" : "Minimize"}
              title={isMin ? "Restore" : "Minimize"}
            >
              <Minimize2 size={15} />
            </button>
            <button
              onClick={() => setLayout(isMax ? "normal" : "max")}
              className="rounded-md p-1 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
              aria-label={isMax ? "Restore" : "Maximize"}
              title={isMax ? "Restore" : "Maximize"}
            >
              {isMax ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
              aria-label="Close"
              title="Stop & close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className={`relative flex items-center justify-center bg-black ${
            isMax ? "min-h-0 flex-1" : "aspect-video"
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-contain ${phase === "live" ? "" : "opacity-0"}`}
          />
          {phase !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-txt-muted">
              {phase === "error" || phase === "ended" ? (
                <MonitorOff size={isMin ? 18 : 28} />
              ) : (
                <Loader2 size={isMin ? 18 : 28} className="animate-spin" />
              )}
              {!isMin && <p className="max-w-sm px-6 text-center text-xs">{statusLine}</p>}
            </div>
          )}

          {/* Screenshot preview — covers the live video temporarily. The live
              connection keeps running underneath, untouched; closing this
              only clears the captured frame from memory. */}
          {screenshot && (
            <div className="absolute inset-0 z-10 flex flex-col bg-black">
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <img
                  src={screenshot.url}
                  alt="Captured screen"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-hair/20 bg-surface-1/95 px-3 py-2">
                <span className="min-w-0 truncate text-[11px] text-txt-muted">
                  Screenshot · {screenshot.capturedAt.toLocaleTimeString()} · not saved anywhere until you
                  download it
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={screenshot.url}
                    download={screenshotFilename(employeeName, screenshot.capturedAt)}
                    className="flex items-center gap-1 rounded-md border border-accentblue/40 bg-accentblue/10 px-2.5 py-1 text-[11px] font-semibold text-accentblue hover:bg-accentblue/20"
                  >
                    <Download size={13} /> Download
                  </a>
                  <button
                    onClick={clearScreenshot}
                    className="rounded-md p-1 text-txt-muted hover:bg-surface-2 hover:text-txt-primary"
                    aria-label="Close screenshot"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isMin && (
          <div className="flex items-center justify-between gap-3 border-t border-hair px-4 py-3 text-[11px] text-txt-muted">
            <span className="flex min-w-0 items-center gap-1.5">
              <Wifi size={12} className="shrink-0" />
              <span className="truncate">
                Peer-to-peer · not recorded · the employee sees a "your screen is
                being viewed" banner
                {stunOnly && " · STUN only (no TURN — may not connect on all networks)"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {canRetry && (
                <button
                  onClick={() => {
                    setMessage("");
                    setPhase("requesting");
                    setAttempt((n) => n + 1);
                  }}
                  className="rounded-md border border-accentblue/40 bg-accentblue/10 px-3 py-1.5 text-xs font-semibold text-accentblue hover:bg-accentblue/20"
                >
                  Retry
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-md border border-hair px-3 py-1.5 text-xs font-semibold text-txt-primary hover:bg-surface-2"
              >
                {phase === "live" || phase === "connecting" ? "Stop & close" : "Close"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
