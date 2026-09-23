const express = require("express");
const http = require("http");
const cors = require("cors");
const session = require("express-session");
require("dotenv").config();

const { connectDB } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const organizationRoutes = require("./routes/organizationRoutes");
const passport = require("./config/passport");
const OrganizationInvitation = require("./models/OrganizationInvitation");
const projectRoutes = require("./routes/projectRoutes");
const invitationRoutes = require("./routes/invitationRoutes");
const { initSocket } = require("./socket");
const notificationRoutes = require("./routes/notificationRoutes");
const questionRoutes = require("./routes/questionRoute");
const monitoringRoutes = require("./routes/monitoringRoute");
const activityRoutes = require("./routes/activityRoutes");
const userRoutes = require("./routes/userRoutes");
const organizationChatRoutes = require("./routes/organizationChatRoutes");
const organizationChatAttachmentRoutes = require("./routes/organizationChatAttachmentRoutes");
const monitoringRecomputeRunner = require("./services/monitoringRecomputeRunner");
const monitoringContentRetention = require("./services/monitoringContentRetention");

const app = express();

app.use(cors());

// Global JSON body parser (default ~100kb limit) for every route EXCEPT the
// monitoring raw-event ingest, which needs a larger cap and mounts its own
// parser in routes/monitoringRoute.js. We skip the global parser for that one
// path so it doesn't reject a large batch before the route-specific parser
// runs. Every other route behaves exactly as before.
const ROUTE_SPECIFIC_PARSER_PATHS = new Set([
  "/api/monitoring/agent/events",
  "/api/monitoring/agent/content",
  "/api/monitoring/agent/screenshot/upload",
]);
const defaultJsonParser = express.json();
app.use((req, res, next) => {
  if (ROUTE_SPECIFIC_PARSER_PATHS.has(req.path)) return next();
  return defaultJsonParser(req, res, next);
});

app.use("/uploads", require("express").static(require("path").join(__dirname, "uploads")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/organization", organizationRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", organizationChatRoutes);
app.use("/api/chat", organizationChatAttachmentRoutes);

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initSocket(server);

async function start() {
  await connectDB();

  // Monitoring derivation consumer (single-instance; see the service header).
  // MONITORING_RECOMPUTE_RUNNER_ENABLED=false turns it off.
  monitoringRecomputeRunner.start();

  // §5b-4 content retention: hard-deletes expired captured content daily.
  // Harmless while the legal gate is closed (no rows exist).
  monitoringContentRetention.start();

  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

start();
