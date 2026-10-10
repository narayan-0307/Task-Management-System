"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
    buildConfig,
    validateConfig,
    checkApiUrl,
    normalizeApiUrl,
} = require("../src/config/config");

const { postJson, InsecureUrlError, NetworkError } =
    require("../src/api/apiClient");

const { sendHeartbeat } = require("../src/auth/agentAuth");

const PRODUCTION_API_BASE_URL =
    "https://darkviolet-cobra-939760.hostingersite.com/api";

const DEV = { isPackaged: false };
const PACKAGED = { isPackaged: true };

function withCleanEnv(fn) {
    const keys = [
        "AGENT_API_BASE_URL",
        "AGENT_UUID",
        "AGENT_SECRET",
        "AGENT_CONFIG_PATH",
    ];

    const saved = {};

    for (const key of keys) {
        saved[key] = process.env[key];
        delete process.env[key];
    }

    try {
        const result = fn();

        if (result && typeof result.finally === "function") {
            return result.finally(() => {
                for (const key of keys) {
                    if (saved[key] === undefined) {
                        delete process.env[key];
                    } else {
                        process.env[key] = saved[key];
                    }
                }
            });
        }

        for (const key of keys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }

        return result;
    } catch (error) {
        for (const key of keys) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }

        throw error;
    }
}

function setElectron(electronExports) {
    const electronPath = require.resolve("electron");

    if (electronExports) {
        require.cache[electronPath] = {
            id: electronPath,
            filename: electronPath,
            loaded: true,
            exports: electronExports,
        };
    } else {
        delete require.cache[electronPath];
    }
}

function stubFetch(respond) {
    const calls = [];

    const real = global.fetch;

    global.fetch = async (url, init) => {
        calls.push(String(url));

        return respond
            ? respond(url, init)
            : {
                  status: 200,
                  json: async () => ({}),
              };
    };

    return {
        calls,
        restore: () => {
            global.fetch = real;
        },
    };
}

// ------------------------------------------------------------ URL policy

test(
    "development: http URLs are accepted (local workflow unchanged)",
    () => {
        assert.deepEqual(
            checkApiUrl(
                "http://localhost:5000/api",
                DEV
            ),
            {
                url: "http://localhost:5000/api",
                error: null,
            }
        );

        assert.equal(
            normalizeApiUrl(
                "http://192.168.1.10/api",
                DEV
            ),
            "http://192.168.1.10/api"
        );

        assert.equal(
            normalizeApiUrl(
                "  http://localhost:5000/api/  ",
                DEV
            ),
            "http://localhost:5000/api"
        );
    }
);

test(
    "packaged: every http URL is rejected as insecure (never upgraded)",
    () => {
        for (const url of [
            "http://example.com/api",
            "http://192.168.1.10/api",
            "http://production-server/api",
            "http://localhost:5000/api",
            "HTTP://EXAMPLE.COM/api",
        ]) {
            assert.deepEqual(
                checkApiUrl(url, PACKAGED),
                {
                    url: null,
                    error: "insecure_url",
                },
                url
            );

            assert.equal(
                normalizeApiUrl(url, PACKAGED),
                null,
                url
            );
        }
    }
);

test(
    "packaged: https URLs are accepted and normalize as before (/api path kept)",
    () => {
        assert.deepEqual(
            checkApiUrl(
                "https://example.com/api",
                PACKAGED
            ),
            {
                url: "https://example.com/api",
                error: null,
            }
        );

        assert.equal(
            normalizeApiUrl(
                "  https://example.com/api///  ",
                PACKAGED
            ),
            "https://example.com/api"
        );

        assert.equal(
            normalizeApiUrl(
                "https://example.com:8443/api",
                PACKAGED
            ),
            "https://example.com:8443/api"
        );

        assert.equal(
            normalizeApiUrl(
                "https://example.com/api",
                DEV
            ),
            "https://example.com/api"
        );
    }
);

test(
    "non-URLs and non-http(s) schemes are invalid in both modes",
    () => {
        for (const opts of [DEV, PACKAGED]) {
            for (const v of [
                "",
                "   ",
                "not a url",
                "ftp://example.com/api",
                "file:///C:/api",
                "ws://example.com",
            ]) {
                assert.equal(
                    checkApiUrl(v, opts).error,
                    "invalid_url",
                    `${v} (${opts.isPackaged})`
                );
            }
        }
    }
);

// ----------------------------------------------------------- buildConfig

const CREDS = {
    agentUuid: "u-1",
    agentSecret: "s-1",
};

test(
    "buildConfig dev: http config still works (existing behavior)",
    () => {
        withCleanEnv(() => {
            const c = buildConfig(
                {
                    ...CREDS,
                    apiBaseUrl:
                        "http://localhost:5000/api/",
                },
                DEV
            );

            assert.equal(
                c.apiBaseUrl,
                "http://localhost:5000/api"
            );

            assert.equal(
                c.apiBaseUrlError,
                null
            );

            assert.doesNotThrow(() =>
                validateConfig(c)
            );
        });
    }
);

test(
    "buildConfig packaged: secure-store API URL is ignored and production URL is used",
    () => {
        withCleanEnv(() => {
            const c = buildConfig(
                {
                    ...CREDS,
                    apiBaseUrl:
                        "https://enrolled.example/api",
                },
                PACKAGED
            );

            assert.equal(
                c.apiBaseUrl,
                PRODUCTION_API_BASE_URL
            );

            assert.equal(
                c.apiBaseUrlError,
                null
            );

            assert.doesNotThrow(() =>
                validateConfig(c)
            );
        });
    }
);

test(
    "buildConfig packaged: HTTP environment URL cannot override production URL",
    () => {
        withCleanEnv(() => {
            process.env.AGENT_API_BASE_URL =
                "http://192.168.1.10/api";

            const c = buildConfig(
                {
                    ...CREDS,
                    apiBaseUrl:
                        "https://ignored.example/api",
                },
                PACKAGED
            );

            assert.equal(
                c.apiBaseUrl,
                PRODUCTION_API_BASE_URL
            );

            assert.equal(
                c.apiBaseUrlError,
                null
            );
        });
    }
);

test(
    "buildConfig packaged: HTTPS environment URL cannot override production URL",
    () => {
        withCleanEnv(() => {
            process.env.AGENT_API_BASE_URL =
                "https://env.example/api";

            const c = buildConfig(
                {
                    ...CREDS,
                    apiBaseUrl:
                        "https://ignored.example/api",
                },
                PACKAGED
            );

            assert.equal(
                c.apiBaseUrl,
                PRODUCTION_API_BASE_URL
            );

            assert.equal(
                c.apiBaseUrlError,
                null
            );

            assert.doesNotThrow(() =>
                validateConfig(c)
            );
        });
    }
);

// ------------------------------------------- transport guard (postJson)

test(
    "packaged transport: postJson refuses http before any connection",
    async () => {
        setElectron({
            app: {
                isPackaged: true,
            },
        });

        const f = stubFetch();

        try {
            await assert.rejects(
                () =>
                    postJson(
                        "http://example.com/api/x",
                        {
                            agent_secret: "s",
                        }
                    ),
                (err) => {
                    assert.ok(
                        err instanceof InsecureUrlError
                    );

                    assert.ok(
                        err instanceof NetworkError,
                        "callers keep data queued, as for any network failure"
                    );

                    return true;
                }
            );

            assert.deepEqual(
                f.calls,
                [],
                "fetch must never be called for an http URL"
            );

            const r = await postJson(
                "https://example.com/api/x",
                {}
            );

            assert.equal(r.status, 200);

            assert.deepEqual(
                f.calls,
                [
                    "https://example.com/api/x",
                ]
            );
        } finally {
            f.restore();
            setElectron(null);
        }
    }
);

test(
    "development transport: postJson still sends to http://localhost",
    async () => {
        const f = stubFetch();

        try {
            const r = await postJson(
                "http://localhost:5000/api/x",
                {}
            );

            assert.equal(r.status, 200);

            assert.deepEqual(
                f.calls,
                [
                    "http://localhost:5000/api/x",
                ]
            );
        } finally {
            f.restore();
        }
    }
);

test(
    "packaged: a heartbeat with an http config never leaves the machine",
    async () => {
        setElectron({
            app: {
                isPackaged: true,
            },
        });

        const f = stubFetch();

        try {
            const r = await sendHeartbeat({
                apiBaseUrl:
                    "http://example.com/api",
                ...CREDS,
            });

            assert.equal(r.ok, false);
            assert.equal(r.kind, "network");

            assert.deepEqual(
                f.calls,
                []
            );
        } finally {
            f.restore();
            setElectron(null);
        }
    }
);

// ------------------------------------------------ no TLS bypass anywhere

test(
    "no TLS certificate-verification bypass exists in the agent",
    () => {
        const root = path.join(
            __dirname,
            ".."
        );

        const BYPASS = [
            /rejectUnauthorized/,
            /NODE_TLS_REJECT_UNAUTHORIZED/,
            /setCertificateVerifyProc/,
            /certificate-error/,
            /ignore-certificate-errors/,
            /allow-insecure-localhost/,
            /checkServerIdentity/,
        ];

        const files = [
            path.join(root, "package.json"),
        ];

        (function walk(dir) {
            for (const e of fs.readdirSync(
                dir,
                {
                    withFileTypes: true,
                }
            )) {
                const p = path.join(
                    dir,
                    e.name
                );

                if (e.isDirectory()) {
                    walk(p);
                } else if (
                    /\.(js|html|json)$/.test(
                        e.name
                    )
                ) {
                    files.push(p);
                }
            }
        })(path.join(root, "src"));

        assert.ok(files.length > 20);

        for (const file of files) {
            const text =
                fs.readFileSync(
                    file,
                    "utf8"
                );

            for (const re of BYPASS) {
                assert.ok(
                    !re.test(text),
                    `${path.relative(
                        root,
                        file
                    )} contains ${re}`
                );
            }
        }
    }
);

// ------------------------------- setup flow in a packaged app (main.js)

test(
    "packaged setup flow: production URL is pinned and HTTP input is rejected",
    async () => {
        const userData = fs.mkdtempSync(
            path.join(
                os.tmpdir(),
                "agent-https-"
            )
        );

        const handlers = {};
        const windows = [];

        class FakeBrowserWindow {
            constructor(opts) {
                this.opts = opts;
                this.webContents = {
                    send() {},
                    session: {},
                };

                windows.push(this);
            }

            loadFile(p) {
                this.loaded = p;
            }

            setMenuBarVisibility() {}

            on() {}

            show() {}

            hide() {}

            focus() {}

            isDestroyed() {
                return false;
            }

            isMinimized() {
                return false;
            }

            destroy() {}

            static getAllWindows() {
                return windows;
            }
        }

        setElectron({
            app: {
                isPackaged: true,
                getPath: () => userData,
                requestSingleInstanceLock: () => true,
                whenReady: () =>
                    new Promise(() => {}),
                on() {},
                quit() {},
                exit() {},
                setLoginItemSettings() {},
            },

            BrowserWindow:
                FakeBrowserWindow,

            ipcMain: {
                handle: (ch, fn) => {
                    handlers[ch] = fn;
                },
                on() {},
            },

            powerMonitor: {
                on() {},
            },

            safeStorage: {
                isEncryptionAvailable: () =>
                    true,

                encryptString: (s) =>
                    Buffer.from(s),

                decryptString: (b) =>
                    b.toString(),
            },

            Tray: class {
                setToolTip() {}

                setContextMenu() {}

                on() {}

                destroy() {}
            },

            Menu: {
                buildFromTemplate: (t) =>
                    t,
            },

            nativeImage: {
                createFromPath: () => ({
                    isEmpty: () => true,
                }),

                createEmpty: () => ({}),
            },

            dialog: {
                showMessageBox() {},
            },

            screen: {
                getPrimaryDisplay: () => ({
                    id: 1,
                    size: {
                        width: 1,
                        height: 1,
                    },
                    scaleFactor: 1,
                }),
            },

            desktopCapturer: {
                getSources: async () => [],
            },
        });

        const f = stubFetch(() => ({
            status: 401,
            json: async () => ({}),
        }));

        try {
            await withCleanEnv(async () => {
                const main =
                    require("../src/main");

                // Packaged builds always expose the production backend.
                assert.deepEqual(
                    main.__test.apiUrlDefaults(),
                    {
                        requireHttps: true,
                        defaultApiBaseUrl:
                            PRODUCTION_API_BASE_URL,
                    }
                );

                const state =
                    await handlers[
                        "agent:getState"
                    ]();

                assert.equal(
                    state.requireHttps,
                    true
                );

                assert.equal(
                    state.defaultApiBaseUrl,
                    PRODUCTION_API_BASE_URL
                );

                assert.ok(
                    !/^http:/i.test(
                        state.defaultApiBaseUrl
                    )
                );

                // HTTP input must still be rejected.
                for (const url of [
                    "http://example.com/api",
                    "http://192.168.1.10/api",
                    "http://production-server/api",
                ]) {
                    const r =
                        await handlers[
                            "agent:connect"
                        ](
                            {},
                            {
                                apiBaseUrl: url,
                                ...CREDS,
                            }
                        );

                    assert.deepEqual(
                        r,
                        {
                            ok: false,
                            code: "insecure_url",
                        },
                        url
                    );
                }

                assert.deepEqual(
                    f.calls,
                    []
                );

                // HTTPS input can proceed to the normal
                // enrollment/authentication flow.
                //
                // Note: this verifies transport behavior.
                // buildConfig itself remains pinned to production.
                const r =
                    await handlers[
                        "agent:connect"
                    ](
                        {},
                        {
                            apiBaseUrl:
                                "https://example.com/api/",
                            ...CREDS,
                        }
                    );

                assert.deepEqual(
                    r,
                    {
                        ok: false,
                        code: "auth",
                    }
                );

                // The entered HTTPS URL passes validation, but the
                // packaged build is pinned, so the heartbeat goes to
                // the production backend, never to the entered host.
                assert.deepEqual(
                    f.calls,
                    [
                        `${PRODUCTION_API_BASE_URL}/monitoring/agent/heartbeat`,
                    ]
                );

                // An old HTTP URL stored on disk must not
                // be contacted at startup.
                fs.writeFileSync(
                    path.join(
                        userData,
                        "agent-credentials.json"
                    ),
                    JSON.stringify({
                        apiBaseUrl:
                            "http://example.com/api",

                        agentUuid:
                            CREDS.agentUuid,

                        secret_enc:
                            Buffer.from(
                                CREDS.agentSecret
                            ).toString(
                                "base64"
                            ),
                    })
                );

                f.calls.length = 0;

                await main.bootstrap();

                // The packaged build ignores the stored URL: the only
                // heartbeat goes to the pinned production HTTPS backend,
                // never to the stored HTTP one.
                assert.ok(
                    f.calls.every((u) => !/^http:/i.test(u)),
                    "no heartbeat to an HTTP backend"
                );

                assert.deepEqual(
                    f.calls,
                    [
                        `${PRODUCTION_API_BASE_URL}/monitoring/agent/heartbeat`,
                    ]
                );

                const setupWin =
                    windows[
                        windows.length - 1
                    ];

                assert.ok(
                    /ui[\\/]+index\.html$/.test(
                        setupWin.loaded
                    )
                );

                assert.equal(
                    setupWin.opts.show,
                    true
                );
            });
        } finally {
            f.restore();
            setElectron(null);

            fs.rmSync(
                userData,
                {
                    recursive: true,
                    force: true,
                }
            );
        }
    }
);