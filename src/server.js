import { createServer } from "node:http";

export function createApplicationServer() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"live"}');
      return;
    }

    response.writeHead(404);
    response.end();
  });
}
