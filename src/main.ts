import { createInstalledApplication } from "./installed-application.ts";
import { installApplicationSignalHandlers } from "./application/application-shutdown.ts";
import { readHttpPort } from "./http-port.ts";

process.umask(0o077);

const port = readHttpPort(process.env.QUALITY_BAR_HTTP_PORT);
const databasePath = "/var/lib/quality-bar/quality-bar.sqlite3";
const application = await createInstalledApplication({
  applicationVersion: process.env.QUALITY_BAR_VERSION,
  certificateAuthorityPath: process.env.NODE_EXTRA_CA_CERTS,
  databasePath,
});
const { server } = application;
installApplicationSignalHandlers(application);

await server.listen({ host: "0.0.0.0", port });
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
