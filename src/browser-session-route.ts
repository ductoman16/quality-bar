import {
  assertNoMixedCredentials,
  authenticationFailureStatus,
  browserMutationFailureStatus,
  implementerTokenFailureStatus,
  passwordMutationFailureStatus,
} from "./http-request.ts";
import { writeMachineOperatorAccessDenial } from "./api-authorization.ts";
import {
  BROWSER_CSRF_COOKIE_NAME,
  BROWSER_SESSION_COOKIE_NAME,
} from "./browser-session.ts";
import { requireCodedError } from "./coded-error.ts";
import { writeEmpty, writeError, writeJson } from "./http-response.ts";

export type AttributionEvent = {
  action: string;
  channel: string;
  errorCode?: string;
  outcome: string;
};

export type HttpHandler = (
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
) => unknown;

const SESSION_MUTATION_ACTIONS = {
  changeOperatorPassword: "password_change",
  createImplementerToken: "implementer_token_create",
  logoutOperator: "session_logout",
  recordBrowserSessionActivity: "session_activity",
  revokeBrowserSessions: "session_revoke_all",
  revokeImplementerToken: "implementer_token_revoke",
  rotateImplementerToken: "implementer_token_rotate",
};

function setSessionCookies(
  response: import("fastify").FastifyReply,
  secret: string,
  csrfToken: string,
  secure: boolean,
) {
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

function clearSessionCookies(
  response: import("fastify").FastifyReply,
  secure: boolean,
) {
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

export function recordBrowserSessionBoundaryFailure(
  request: import("fastify").FastifyRequest,
  failure: { code: string },
  recordAuthorityAttribution: (event: AttributionEvent) => void,
) {
  const action =
    SESSION_MUTATION_ACTIONS[
      request.routeOptions.schema
        ?.operationId as keyof typeof SESSION_MUTATION_ACTIONS
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

export function rejectOperatorLoginCredentials(
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
  implementerTokens: any,
  recordAuthorityAttribution: (event: AttributionEvent) => void,
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

function loginRetryAfterSeconds(error: ReturnType<typeof requireCodedError>) {
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

function writeAuthenticationError(
  response: import("fastify").FastifyReply,
  error: ReturnType<typeof requireCodedError>,
  status: (code: string) => number,
) {
  if (error.message === "request_malformed") {
    writeError(response, 400, "request_malformed", "Request is malformed");
  } else {
    writeError(response, status(error.code), error.code, error.message);
  }
}

export function createBrowserSessionOperations({
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
  secureBrowserCookie,
}: {
  browserSessions: any;
  implementerTokens: any;
  recordAuthorityAttribution: (event: AttributionEvent) => void;
  secureBrowserCookie: boolean;
}) {
  const verifiedSessionSecret = (request: import("fastify").FastifyRequest) =>
    (request as any).browserSessionSecret as string;

  function passwordMutation(
    action: string,
    response: import("fastify").FastifyReply,
    mutate: () => void,
  ) {
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

  function implementerTokenMutation(
    action:
      | "implementer_token_create"
      | "implementer_token_revoke"
      | "implementer_token_rotate",
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
  ) {
    try {
      const { password } = request.body as { password: string };
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

  const operations: Record<string, HttpHandler> = {
    loginOperator(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      try {
        const { password } = request.body as { password: string };
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
    logoutOperator(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
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
    recordBrowserSessionActivity(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
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
    changeOperatorPassword(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      passwordMutation("password_change", response, () => {
        const { current_password, new_password } = request.body as {
          current_password: string;
          new_password: string;
        };
        browserSessions.changePassword(current_password, new_password);
        clearSessionCookies(response, secureBrowserCookie);
        writeEmpty(response);
      });
    },
    revokeBrowserSessions(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      passwordMutation("session_revoke_all", response, () => {
        const { password } = request.body as { password: string };
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
