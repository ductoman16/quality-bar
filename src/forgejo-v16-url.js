/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @param {string} baseUrl */
export function normalizedForgejoBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    fail("forgejo_url_invalid", "Forgejo URL is invalid");
  }
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail("forgejo_url_invalid", "Forgejo URL is invalid");
  }
  return url.toString().replace(/\/$/, "");
}
