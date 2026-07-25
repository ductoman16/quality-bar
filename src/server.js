import { createServer } from "node:http";

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isProductSurface(path) {
  return (
    path === "/" ||
    path === "/api/v1" ||
    path.startsWith("/api/v1/") ||
    path === "/mcp/v1" ||
    path.startsWith("/mcp/v1/")
  );
}

export function createApplicationServer(readDurableCoreStatus, readSystemStatus = () => ({})) {
  if (typeof readDurableCoreStatus !== "function") {
    throw new TypeError("readDurableCoreStatus is required");
  }
  if (typeof readSystemStatus !== "function") {
    throw new TypeError("readSystemStatus must be a function");
  }

  return createServer((request, response) => {
    const path = request.url.split("?", 1)[0];
    if (request.method === "GET" && path === "/health/live") {
      writeJson(response, 200, { status: "live" });
      return;
    }

    const durableCoreStatus = readDurableCoreStatus();
    if (request.method === "GET" && path === "/health/ready") {
      if (durableCoreStatus.status === "ready") {
        writeJson(response, 200, { status: "ready" });
      } else {
        writeJson(response, 503, durableCoreStatus);
      }
      return;
    }

    if (isProductSurface(path) && durableCoreStatus.status !== "ready") {
      writeJson(response, 503, { error: durableCoreStatus.error });
      return;
    }

    if (request.method === "GET" && path === "/api/v1/system") {
      writeJson(response, 200, readSystemStatus());
      return;
    }

    response.writeHead(404);
    response.end();
  });
}
