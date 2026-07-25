import { createApplicationServer } from "./server.js";

const port = 3000;
const server = createApplicationServer();

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
