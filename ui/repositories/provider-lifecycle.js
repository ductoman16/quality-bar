import { csrfRequest, requireStatus } from "../browser.js";
import {
  validForgejoConnection,
  validGitHubConnection,
  validLifecycleChange,
} from "./contract.js";

export async function readProviderConnection(provider) {
  const response = await fetch(`/api/v1/${provider}-connections`);
  await requireStatus(response, 200, "connection_response_invalid");
  const value = await response.json();
  const valid =
    provider === "github" ? validGitHubConnection : validForgejoConnection;
  if (!valid(value)) {
    throw new Error("connection_response_invalid");
  }
  return value;
}

export async function rethrowAfterRefresh(refresh, message) {
  try {
    await refresh();
  } catch (failure) {
    const detail =
      failure instanceof Error ? failure.message : "Connection refresh failed";
    throw new Error(`${message}; ${detail}`);
  }
  throw new Error(message);
}

export async function requestProviderReactivation(
  csrfCookieName,
  provider,
  credential,
) {
  const response = await csrfRequest(
    csrfCookieName,
    `/api/v1/${provider}-connections/reactivate`,
    provider === "github" ? { pem: credential } : { token: credential },
  );
  await requireStatus(
    response,
    200,
    `${provider}_reactivation_response_invalid`,
  );
  const value = await response.json();
  const valid =
    provider === "github" ? validGitHubConnection : validForgejoConnection;
  if (value === null || !valid(value)) {
    throw new Error("Connection reactivation response is invalid");
  }
  return value;
}

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
