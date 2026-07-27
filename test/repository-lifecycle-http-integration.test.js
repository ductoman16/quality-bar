import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryService, RepositoryError } from "../src/repository.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("an authenticated operator changes Repository lifecycle through the canonical HTTP resource", async () => {
  let verificationFails = false;
  const { request } = await startApplication({
    createRepositories(core, options) {
      return createRepositoryService(core, {
        ...options,
        createId: () => "repository/public",
        async verifyRead() {
          if (verificationFails) {
            return Promise.reject(
              new RepositoryError(
                "repository_git_read_failed",
                "Repository Git read verification failed",
              ),
            );
          }
        },
      });
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const registered = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/public.git" }),
    headers,
    method: "POST",
  });
  assert.equal(registered.status, 200);

  const disabled = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "disabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), {
    credential_type: "none",
    health: "healthy",
    health_error: null,
    id: "repository/public",
    lifecycle: "disabled",
    url: "https://example.com/public.git",
  });

  verificationFails = true;
  const failedEnable = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(failedEnable.status, 422);
  assert.equal(
    await responseErrorCode(failedEnable),
    "repository_git_read_failed",
  );
  const afterFailedEnable = await request("/api/v1/repositories", {
    headers: { cookie: headers.cookie },
  });
  assert.deepEqual(await afterFailedEnable.json(), {
    items: [
      {
        credential_type: "none",
        health: "error",
        health_error: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        id: "repository/public",
        lifecycle: "disabled",
        url: "https://example.com/public.git",
      },
    ],
    next_cursor: null,
  });

  verificationFails = false;
  const enabled = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(enabled.status, 200);
  assert.deepEqual(await enabled.json(), {
    credential_type: "none",
    health: "healthy",
    health_error: null,
    id: "repository/public",
    lifecycle: "enabled",
    url: "https://example.com/public.git",
  });
});
