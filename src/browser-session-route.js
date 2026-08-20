import {
  assertNoMixedCredentials,
  authenticationFailureStatus,
  browserMutationFailureStatus,
  implementerTokenFailureStatus,
  passwordMutationFailureStatus,
} from "./http-request.js";
import { writeMachineOperatorAccessDenial } from "./api-authorization.js";
import {
  BROWSER_CSRF_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
} from "./browser-session.js";
import { requireCodedError } from "./coded-error.js";
import { writeEmpty, writeError, writeJson } from "./http-response.js";

/** @typedef {{action: string, channel: string, errorCode?: string, outcome: string}} AttributionEvent */
/** @typedef {(request: import("fastify").FastifyRequest, response: import("fastify").FastifyReply) => unknown} HttpHandler */

const SESSION_MUTATION_ACTIONS = {
  changeOperatorPassword: "password_change",
  createImplementerToken: "implementer_token_create",
  logoutOperator: "session_logout",
  recordBrowserSessionActivity: "session_activity",
  revokeBrowserSessions: "session_revoke_all",
  revokeImplementerToken: "implementer_token_revoke",
  rotateImplementerToken: "implementer_token_rotate",
};

/** @param {import("fastify").FastifyReply} response @param {string} secret @param {string} csrfToken @param {boolean} secure */
function setSessionCookies(response, secret, csrfToken, secure) {
  response
    .setCookie(BROWSER_SESSION_COOKIE_NAME, secret, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    })
    .setCookie(BROWSER_CSRF_COOKIE_NAME, csrfToken, {
      path: "/",
      sameSite: "strict",
      secure,
    });
}

/** @param {import("fastify").FastifyReply} response @param {boolean} secure */
function clearSessionCookies(response, secure) {
  response
    .clearCookie(BROWSER_SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure,
    })
    .clearCookie(BROWSER_CSRF_COOKIE_NAME, {
      path: "/",
      sameSite: "strict",
      secure,
    });
}

/** @param {import("fastify").FastifyRequest} request @param {{code: string}} failure @param {(event: AttributionEvent) => void} recordAuthorityAttribution */
export function recordBrowserSessionBoundaryFailure(
  request,
  failure,
  recordAuthorityAttribution,
) {
  const action =
    SESSION_MUTATION_ACTIONS[
      /** @type {keyof typeof SESSION_MUTATION_ACTIONS} */ (
        request.routeOptions.schema?.operationId
      )
    ];
  if (action) {
    recordAuthorityAttribution({
      action,
      channel: "browser_session",
      errorCode: failure.code,
      outcome: "failure",
    });
  }
}

/** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response @param {any} implementerTokens @param {(event: AttributionEvent) => void} recordAuthorityAttribution */
export function rejectOperatorLoginCredentials(
  request,
  response,
  implementerTokens,
  recordAuthorityAttribution,
) {
  if (request.headers.authorization === undefined) {
    return false;
  }
  if (request.headers.cookie === undefined) {
    writeMachineOperatorAccessDenial(
      request,
      response,
      implementerTokens,
      recordAuthorityAttribution,
    );
    return true;
  }
  try {
    assertNoMixedCredentials(request);
    return false;
  } catch (error) {
    const failure = requireCodedError(error);
    recordAuthorityAttribution({
      action: "authentication",
      channel: "browser_session",
      errorCode: failure.code,
      outcome: "failure",
    });
    writeError(
      response,
      authenticationFailureStatus(failure.code),
      failure.code,
      failure.message,
    );
    return true;
  }
}

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

/** @param {{browserSessions: any, implementerTokens: any, recordAuthorityAttribution: (event: AttributionEvent) => void, secureBrowserCookie: boolean}} dependencies */
export function createBrowserSessionOperations({
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
  secureBrowserCookie,
}) {
  /** @param {import("fastify").FastifyRequest} request */
  const verifiedSessionSecret = (request) =>
    /** @type {string} */ (/** @type {any} */ (request).browserSessionSecret);

  /** @param {string} action @param {import("fastify").FastifyReply} response @param {() => void} mutate */
  function passwordMutation(action, response, mutate) {
    try {
      mutate();
    } catch (error) {
      const failure = requireCodedError(error);
      recordAuthorityAttribution({
        action,
        channel: "browser_session",
        errorCode: failure.code,
        outcome: "failure",
      });
      writeAuthenticationError(
        response,
        failure,
        passwordMutationFailureStatus,
      );
    }
  }

  /** @param {"implementer_token_create" | "implementer_token_revoke" | "implementer_token_rotate"} action @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
  function implementerTokenMutation(action, request, response) {
    try {
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
      writeAuthenticationError(
        response,
        failure,
        implementerTokenFailureStatus,
      );
    }
  }

  /** @type {Record<string, HttpHandler>} */
  const operations = {
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    loginOperator(request, response) {
      try {
        const { password } = /** @type {{password: string}} */ (request.body);
        const { csrfToken, secret } = browserSessions.login(password);
        setSessionCookies(response, secret, csrfToken, secureBrowserCookie);
        writeEmpty(response);
      } catch (error) {
        const failure = requireCodedError(error);
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
        browserSessions.logout(verifiedSessionSecret(request));
        clearSessionCookies(response, secureBrowserCookie);
        writeEmpty(response);
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
        const secret = verifiedSessionSecret(request);
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
      passwordMutation("password_change", response, () => {
        const { current_password, new_password } =
          /** @type {{current_password: string, new_password: string}} */ (
            request.body
          );
        browserSessions.changePassword(current_password, new_password);
        clearSessionCookies(response, secureBrowserCookie);
        writeEmpty(response);
      });
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    revokeBrowserSessions(request, response) {
      passwordMutation("session_revoke_all", response, () => {
        const { password } = /** @type {{password: string}} */ (request.body);
        browserSessions.revokeAll(password);
        clearSessionCookies(response, secureBrowserCookie);
        writeEmpty(response);
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
