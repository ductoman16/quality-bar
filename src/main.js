import { createApplication } from "./application.js";

process.umask(0o077);

const port = 3000;
const databasePath = "/var/lib/quality-bar/quality-bar.sqlite3";
const application = createApplication({ databasePath });
const { server } = application;

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "info",
      event: "application_started",
      component: "http",
      outcome: "success",
      port,
    })}\n`,
  );
});
