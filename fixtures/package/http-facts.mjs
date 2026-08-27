const [port] = process.argv.slice(2);
const endpoint = `http://127.0.0.1:${port}`;

async function pollLiveness() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/health/live`);
      const body = /** @type {{status?: string}} */ (await response.json());
      if (response.status === 200 && body.status === "live") {
        return { body, status: response.status };
      }
      lastError = new Error(`unexpected_liveness_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw lastError ?? new Error("package_probe_liveness_timeout");
}

console.log(JSON.stringify({ liveness: await pollLiveness() }));
