import { requireCodedError } from "./coded-error.ts";
import {
  authenticationFailureStatus,
  requireImplementerTokenAuthority,
} from "./http-request.ts";
import { writeError } from "./http-response.ts";

export type AttributionEvent = {
  action: string;
  channel: string;
  errorCode?: string;
  outcome: string;
};

export function forbidMachineOperatorAccess(
  response: import("fastify").FastifyReply,
  recordAuthorityAttribution: (event: AttributionEvent) => void,
) {
  recordAuthorityAttribution({
    action: "authorization",
    channel: "implementer_token",
    errorCode: "authorization_forbidden",
    outcome: "forbidden",
  });
  writeError(
    response,
    403,
    "authorization_forbidden",
    "Machine access is forbidden",
  );
}

export function writeMachineOperatorAccessDenial(
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
  implementerTokens: ReturnType<
    typeof import("./implementer-token.ts").createImplementerTokenService
  >,
  recordAuthorityAttribution: (event: AttributionEvent) => void,
) {
  try {
    requireImplementerTokenAuthority(implementerTokens, request);
    recordAuthorityAttribution({
      action: "authentication",
      channel: "implementer_token",
      outcome: "success",
    });
    forbidMachineOperatorAccess(response, recordAuthorityAttribution);
  } catch (error) {
    const failure = requireCodedError(error);
    recordAuthorityAttribution({
      action: "authentication",
      channel: "implementer_token",
      errorCode: failure.code,
      outcome: "failure",
    });
    writeError(
      response,
      authenticationFailureStatus(failure.code),
      failure.code,
      failure.message,
    );
  }
}
