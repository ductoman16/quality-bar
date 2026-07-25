export function readHttpPort(value) {
  if (!/^(?:[1-9]\d{0,4})$/.test(value ?? "")) {
    throw new Error("QUALITY_BAR_HTTP_PORT must be a valid TCP port");
  }

  const port = Number(value);
  if (port > 65_535) {
    throw new Error("QUALITY_BAR_HTTP_PORT must be a valid TCP port");
  }

  return port;
}
