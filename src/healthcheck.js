const response = await fetch("http://127.0.0.1:3000/health/live");

if (!response.ok) {
  throw new Error(`liveness probe returned HTTP ${response.status}`);
}
