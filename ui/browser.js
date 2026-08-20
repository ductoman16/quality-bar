/** @param {string} name */
export function csrfToken(name) {
  const token = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("=", 2))
    .find(([cookieName]) => cookieName === name)?.[1];
  if (!token) {
    throw new Error("browser_csrf_unavailable");
  }
  return token;
}

/** @param {string} name @param {string} path @param {unknown} body @param {string} [method] */
export function csrfRequest(name, path, body, method = "POST") {
  return fetch(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-quality-bar-csrf": csrfToken(name),
    },
    method,
  });
}

/** @param {Response} response @param {string} fallback */
export async function responseMessage(response, fallback) {
  try {
    const body = await response.json();
    return typeof body?.error?.message === "string"
      ? body.error.message
      : fallback;
  } catch {
    return fallback;
  }
}

export async function repositoryCollection() {
  const items = /** @type {any[]} */ ([]);
  const cursors = new Set();
  let path = "/api/v1/repositories";
  for (;;) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(
        await responseMessage(response, "Repositories failed to load"),
      );
    }
    const body = await response.json();
    if (
      !Array.isArray(body.items) ||
      (body.next_cursor !== null && typeof body.next_cursor !== "string")
    ) {
      throw new Error("repository_collection_invalid");
    }
    items.push(...body.items);
    if (body.next_cursor === null) {
      return items;
    }
    if (!body.next_cursor || cursors.has(body.next_cursor)) {
      throw new Error("repository_collection_invalid");
    }
    cursors.add(body.next_cursor);
    path =
      "/api/v1/repositories?cursor=" + encodeURIComponent(body.next_cursor);
  }
}

export function returnToLogin() {
  location.assign(
    "/?return_to=" + encodeURIComponent(location.pathname + location.search),
  );
}
