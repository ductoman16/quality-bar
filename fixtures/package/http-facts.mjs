const [port] = process.argv.slice(2);
const endpoint = `http://127.0.0.1:${port}`;

/**
 * @param {string} path
 * @param {Record<string, string>} [headers]
 */
async function responseFacts(path, headers) {
  const response = await fetch(`${endpoint}${path}`, { headers });
  const body = /** @type {{error: {code: string}, status?: string}} */ (
    await response.json()
  );
  return { body, status: response.status };
}

const liveness = await responseFacts("/health/live");
const readiness = await responseFacts("/health/ready");
const directSystem = await responseFacts("/api/v1/system");
const forwardedSystem = await responseFacts("/api/v1/system", {
  forwarded: "for=203.0.113.24;host=quality-bar.example;proto=https",
});

console.log(
  JSON.stringify({
    directSystem: {
      errorCode: directSystem.body.error.code,
      status: directSystem.status,
    },
    forwardedSystem: {
      errorCode: forwardedSystem.body.error.code,
      status: forwardedSystem.status,
    },
    liveness,
    readiness,
  }),
);
