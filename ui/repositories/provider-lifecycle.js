import { csrfRequest, requireStatus } from "../browser.js";
import { validLifecycleChange } from "./contract.js";

export async function requestConnectionLifecycle(
  csrfCookieName,
  provider,
  method,
) {
  const response = await csrfRequest(
    csrfCookieName,
    `/api/v1/${provider}-connections/lifecycle`,
    method === "PATCH" ? { lifecycle: "retired" } : {},
    method,
  );
  await requireStatus(response, 200, "connection_lifecycle_response_invalid");
  const current = await response.json();
  if (!validLifecycleChange(provider, method, current)) {
    throw new Error("Connection lifecycle response is invalid");
  }
  return current;
}
