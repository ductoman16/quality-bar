import { createInstalledApplication } from "./installed-application.js";
import { installApplicationSignalHandlers } from "./application-shutdown.js";
import { readHttpPort } from "./http-port.js";

process.umask(0o077);

const port = readHttpPort(process.env.QUALITY_BAR_HTTP_PORT);
const databasePath = "/var/lib/quality-bar/quality-bar.sqlite3";
const application = await createInstalledApplication({
  applicationVersion: process.env.QUALITY_BAR_VERSION,
  databasePath,
});
const { server } = application;
installApplicationSignalHandlers(application);

server.listen(port, "127.0.0.1", () => {
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
