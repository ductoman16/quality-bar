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

/** @param {Response} response */
export async function responseError(response) {
  const body = await response.json();
  if (
    typeof body?.error?.code !== "string" ||
    !body.error.code ||
    typeof body.error.message !== "string" ||
    !body.error.message ||
    typeof body.error.request_id !== "string" ||
    !body.error.request_id
  ) {
    throw new Error("error_response_invalid");
  }
  if (
    response.status === 401 &&
    body.error.code === "authentication_required"
  ) {
    returnToLogin();
  }
  return body.error;
}

/** @param {Response} response */
export async function responseMessage(response) {
  return (await responseError(response)).message;
}

/** @param {Response} response @param {number} expected @param {string} invalid */
export async function requireStatus(response, expected, invalid) {
  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }
  if (response.status !== expected) {
    throw new Error(invalid);
  }
}

export async function repositoryCollection() {
  const items = /** @type {any[]} */ ([]);
  const cursors = new Set();
  let path = "/api/v1/repositories";
  for (;;) {
    const response = await fetch(path);
    await requireStatus(response, 200, "repository_collection_invalid");
    const body = await response.json();
    if (
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "items") ||
      !Object.hasOwn(body, "next_cursor") ||
      !Array.isArray(body.items) ||
      !body.items.every(validRepository) ||
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
import { validRepository } from "./repositories/contract.js";
