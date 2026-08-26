import { readHttpPort } from "./http-port.ts";

const port = readHttpPort(process.env.QUALITY_BAR_HTTP_PORT);

const response = await fetch(`http://127.0.0.1:${port}/health/live`);

if (!response.ok) {
  throw new Error(`liveness probe returned HTTP ${response.status}`);
}
