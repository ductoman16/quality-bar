import {
  assertNoMixedCredentials,
  authenticationFailureStatus,
  browserMutationFailureStatus,
  clearedSessionCookies,
  csrfCookie,
  implementerTokenFailureStatus,
  passwordMutationFailureStatus,
  requireBrowserMutation,
  sessionCookie,
} from "./http-request.js";
import { writeMachineOperatorAccessDenial } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import { writeEmpty, writeError, writeJson } from "./http-response.js";

/** @typedef {{action: string, channel: string, errorCode?: string, outcome: string}} AttributionEvent */
/** @typedef {(request: import("fastify").FastifyRequest, response: import("fastify").FastifyReply) => unknown} HttpHandler */

/** @param {ReturnType<typeof requireCodedError>} error */
function loginRetryAfterSeconds(error) {
  if (
    !("retryAfterSeconds" in error) ||
    typeof error.retryAfterSeconds !== "number"
  ) {
    throw new TypeError(
      "login_throttled error must provide retryAfterSeconds",
      { cause: error },
    );
  }
  return error.retryAfterSeconds;
}

/** @param {import("fastify").FastifyReply} response @param {ReturnType<typeof requireCodedError>} error @param {(code: string) => number} status */
function writeAuthenticationError(response, error, status) {
  if (error.message === "request_malformed") {
    writeError(response, 400, "request_malformed", "Request is malformed");
  } else {
    writeError(response, status(error.code), error.code, error.message);
  }
}

/** @param {{browserOrigin: string, browserSessions: any, implementerTokens: any, recordAuthorityAttribution: (event: AttributionEvent) => void, secureBrowserCookie: boolean}} dependencies */
export function createBrowserSessionOperations({
  browserOrigin,
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
  secureBrowserCookie,
}) {
  /** @param {import("fastify").FastifyRequest} request */
  const requireMutation = (request) =>
    requireBrowserMutation(browserSessions, request, browserOrigin);

  /** @param {string} action @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response @param {() => void} mutate */
  function passwordMutation(action, request, response, mutate) {
    try {
      requireMutation(request);
      mutate();
    } catch (error) {
      const failure = requireCodedError(error);
      recordAuthorityAttribution({
        action,
        channel: "browser_session",
        errorCode: failure.code,
        outcome: "failure",
      });
      writeAuthenticationError(response, failure, (code) =>
        browserMutationFailureStatus(code) === 403
          ? 403
          : passwordMutationFailureStatus(code),
      );
    }
  }

  /** @param {"implementer_token_create" | "implementer_token_revoke" | "implementer_token_rotate"} action @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
  function implementerTokenMutation(action, request, response) {
    try {
      requireMutation(request);
      const { password } = /** @type {{password: string}} */ (request.body);
      if (action === "implementer_token_revoke") {
        implementerTokens.revoke(password);
        writeEmpty(response);
      } else {
        const rotating = action === "implementer_token_rotate";
        const token = rotating
          ? implementerTokens.rotate(password)
          : implementerTokens.create(password);
        writeJson(response, rotating ? 200 : 201, { token });
      }
    } catch (error) {
      const failure = requireCodedError(error);
      recordAuthorityAttribution({
        action,
        channel: "browser_session",
        errorCode: failure.code,
        outcome: "failure",
      });
      writeAuthenticationError(response, failure, (code) =>
        browserMutationFailureStatus(code) === 403
          ? 403
          : implementerTokenFailureStatus(code),
      );
    }
  }

  /** @type {Record<string, HttpHandler>} */
  const operations = {
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    loginOperator(request, response) {
      if (
        request.headers.authorization !== undefined &&
        request.headers.cookie === undefined
      ) {
        writeMachineOperatorAccessDenial(
          request,
          response,
          implementerTokens,
          recordAuthorityAttribution,
        );
        return;
      }
      try {
        assertNoMixedCredentials(request);
        const { password } = /** @type {{password: string}} */ (request.body);
        const { csrfToken, secret } = browserSessions.login(password);
        writeEmpty(response, {
          "set-cookie": [
            sessionCookie(secret, secureBrowserCookie),
            csrfCookie(csrfToken, secureBrowserCookie),
          ],
        });
      } catch (error) {
        const failure = requireCodedError(error);
        if (failure.code === "authentication_ambiguous") {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: failure.code,
            outcome: "failure",
          });
        }
        writeError(
          response,
          authenticationFailureStatus(failure.code),
          failure.code,
          failure.message,
          failure.code === "login_throttled"
            ? { "retry-after": String(loginRetryAfterSeconds(failure)) }
            : undefined,
        );
      }
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    logoutOperator(request, response) {
      try {
        browserSessions.logout(requireMutation(request));
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "session_logout",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeAuthenticationError(
          response,
          failure,
          browserMutationFailureStatus,
        );
      }
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    recordBrowserSessionActivity(request, response) {
      try {
        const secret = requireMutation(request);
        if (
          !browserSessions.touch(
            secret,
            typeof request.headers["x-quality-bar-csrf"] === "string"
              ? request.headers["x-quality-bar-csrf"]
              : undefined,
          )
        ) {
          throw Object.assign(new Error("Browser session is required"), {
            code: "authentication_required",
          });
        }
        writeEmpty(response);
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "session_activity",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeAuthenticationError(
          response,
          failure,
          browserMutationFailureStatus,
        );
      }
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    changeOperatorPassword(request, response) {
      passwordMutation("password_change", request, response, () => {
        const { current_password, new_password } =
          /** @type {{current_password: string, new_password: string}} */ (
            request.body
          );
        browserSessions.changePassword(current_password, new_password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      });
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    revokeBrowserSessions(request, response) {
      passwordMutation("session_revoke_all", request, response, () => {
        const { confirmation, password } =
          /** @type {{confirmation: string, password: string}} */ (
            request.body
          );
        if (confirmation !== "REVOKE ALL SESSIONS") {
          throw Object.assign(
            new Error("Global browser-session revocation must be confirmed"),
            { code: "session_revocation_confirmation_invalid" },
          );
        }
        browserSessions.revokeAll(password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      });
    },
    createImplementerToken: (request, response) =>
      implementerTokenMutation("implementer_token_create", request, response),
    rotateImplementerToken: (request, response) =>
      implementerTokenMutation("implementer_token_rotate", request, response),
    revokeImplementerToken: (request, response) =>
      implementerTokenMutation("implementer_token_revoke", request, response),
  };
  return operations;
}
