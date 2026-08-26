import { redactOrdinaryDetail } from "../../src/application/application-log.ts";
import {
  formatGitHubAggregateFeedback,
  formatGitHubInlineFeedback,
} from "../../src/github/github-feedback.ts";

const KIND = "private-github-canary";
const REST_PROFILE = "2026-03-10";

function failure(code: string, detail: string) {
  return Object.assign(new Error(detail), { code });
}

function validCommit(value: unknown) {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)
  );
}

function validateFixture(fixture: any) {
  const pullRequest = fixture?.pull_request;
  const inline = pullRequest?.inline;
  if (
    typeof fixture?.fixture_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(fixture.fixture_id) ||
    !Number.isSafeInteger(fixture.installation_id) ||
    fixture.installation_id <= 0 ||
    !Number.isSafeInteger(fixture.repository?.id) ||
    fixture.repository.id <= 0 ||
    typeof fixture.repository?.full_name !== "string" ||
    !/^[^/]+\/[^/]+$/u.test(fixture.repository.full_name) ||
    !Number.isSafeInteger(pullRequest?.number) ||
    pullRequest.number <= 0 ||
    !validCommit(pullRequest.base) ||
    !validCommit(pullRequest.head) ||
    typeof inline?.path !== "string" ||
    inline.path.length === 0 ||
    !Number.isSafeInteger(inline.line) ||
    inline.line <= 0 ||
    !["LEFT", "RIGHT"].includes(inline.side)
  ) {
    throw failure(
      "private_github_canary_fixture_invalid",
      "private GitHub canary fixture is invalid",
    );
  }
  let origin;
  try {
    origin = new URL(fixture.target_origin);
  } catch {
    throw failure(
      "private_github_canary_fixture_invalid",
      "private GitHub canary fixture is invalid",
    );
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== origin.href.replace(/\/$/u, "")
  ) {
    throw failure(
      "private_github_canary_fixture_invalid",
      "private GitHub canary fixture is invalid",
    );
  }
  return fixture;
}

function canaryIdentity(fixture: any) {
  const detailsUrl = new URL("/", fixture.target_origin);
  detailsUrl.searchParams.set("view", "evaluations");
  detailsUrl.searchParams.set("evaluation_id", fixture.fixture_id);
  return {
    base_commit: fixture.pull_request.base,
    details_url: detailsUrl.href,
    evaluation_id: fixture.fixture_id,
    head_commit: fixture.pull_request.head,
  };
}

async function reconcileOrPublish({
  failureCode,
  reconcile,
  publish,
}: {
  failureCode: string;
  reconcile: () => Promise<any>;
  publish: () => Promise<any>;
}) {
  const existing = await reconcile();
  const identity = existing ?? (await publish());
  const reconciled = await reconcile();
  if (
    !Number.isSafeInteger(identity) ||
    identity <= 0 ||
    reconciled !== identity
  ) {
    throw failure(
      failureCode,
      "GitHub publication did not reconcile to exactly one source identity",
    );
  }
  return identity;
}

export async function invokePrivateGitHubCanary({
  applicationVersion = null,
  credential,
  fixture: fixtureInput,
  gitVersion = null,
  now = () => Date.now(),
  sourceCommit = null,
  verifier,
}: {
  applicationVersion?: string | null;
  credential: any;
  fixture: any;
  gitVersion?: string | null;
  now?: () => number;
  sourceCommit?: string | null;
  verifier: any;
}) {
  const startedAt = now();
  const knownSecrets =
    typeof credential?.pem === "string" ? [credential.pem] : [];
  const fixtureEvidence = {
    id: fixtureInput?.fixture_id ?? null,
    repository: fixtureInput?.repository?.full_name ?? null,
    pullRequest: fixtureInput?.pull_request?.number ?? null,
    base: fixtureInput?.pull_request?.base ?? null,
    head: fixtureInput?.pull_request?.head ?? null,
  };
  const common = {
    kind: KIND,
    sourceCommit,
    fixture: fixtureEvidence,
    versions: {
      application: applicationVersion,
      node: process.version,
      git: gitVersion,
      githubRest: REST_PROFILE,
    },
    startedAt: new Date(startedAt).toISOString(),
  };
  let fixtureValidated = false;
  try {
    const fixture = validateFixture(fixtureInput);
    fixtureValidated = true;
    if (!verifier || typeof verifier.verifyInstallation !== "function") {
      throw failure(
        "private_github_canary_dependencies_invalid",
        "private GitHub canary dependencies are invalid",
      );
    }
    const installation = await verifier.verifyInstallation(
      credential,
      fixture.installation_id,
      [fixture.repository.id],
    );
    const repository = installation?.repositories?.find(
      (candidate: any) => candidate.id === fixture.repository.id,
    );
    if (
      !repository ||
      repository.full_name !== fixture.repository.full_name ||
      repository.private !== true
    ) {
      throw failure(
        "private_github_canary_repository_mismatch",
        "dedicated Repository is not the verified private fixture",
      );
    }
    const pullRequests = await verifier.listPullRequests(
      credential,
      fixture.installation_id,
      fixture.repository,
    );
    const pullRequest = pullRequests.find(
      (candidate: any) => candidate.number === fixture.pull_request.number,
    );
    if (
      !pullRequest ||
      pullRequest.state !== "open" ||
      pullRequest.draft ||
      pullRequest.merged_at !== null ||
      pullRequest.base?.sha !== fixture.pull_request.base ||
      pullRequest.head?.sha !== fixture.pull_request.head
    ) {
      throw failure(
        "private_github_canary_pull_request_mismatch",
        "dedicated pull request does not match the frozen fixture",
      );
    }

    const identity = canaryIdentity(fixture);
    const aggregateBody = formatGitHubAggregateFeedback(
      { ...identity, outcome: "clear" },
      [],
    );
    const inlineComment = {
      body: formatGitHubInlineFeedback(identity, {
        evidence: "Private GitHub canary valid-coordinate proof.",
        id: `${fixture.fixture_id}:inline`,
        impact: "advisory",
        remediation: "No remediation required; this is release evidence.",
      }),
      commit_id: fixture.pull_request.head,
      ...fixture.pull_request.inline,
    };
    const status = {
      description: "Quality Bar private GitHub canary is clear",
      head: fixture.pull_request.head,
      state: "success",
      targetUrl: identity.details_url,
    };
    const statusId = await reconcileOrPublish({
      failureCode: "private_github_canary_status_reconciliation_failed",
      reconcile: () =>
        verifier.reconcileCommitStatus(
          credential,
          fixture.installation_id,
          repository,
          status,
        ),
      publish: () =>
        verifier.publishCommitStatus(
          credential,
          fixture.installation_id,
          repository,
          status,
        ),
    });
    const aggregateId = await reconcileOrPublish({
      failureCode: "private_github_canary_aggregate_reconciliation_failed",
      reconcile: () =>
        verifier.reconcileAggregateFeedback(
          credential,
          fixture.installation_id,
          repository,
          fixture.pull_request.number,
          aggregateBody,
        ),
      publish: () =>
        verifier.publishAggregateFeedback(
          credential,
          fixture.installation_id,
          repository,
          fixture.pull_request.number,
          aggregateBody,
        ),
    });
    const inlineId = await reconcileOrPublish({
      failureCode: "private_github_canary_inline_reconciliation_failed",
      reconcile: () =>
        verifier.reconcileInlineFeedback(
          credential,
          fixture.installation_id,
          repository,
          fixture.pull_request.number,
          inlineComment,
        ),
      publish: () =>
        verifier.publishInlineFeedback(
          credential,
          fixture.installation_id,
          repository,
          fixture.pull_request.number,
          inlineComment,
        ),
    });
    return {
      ...common,
      fixture: fixtureValidated ? common.fixture : null,
      completedAt: new Date(now()).toISOString(),
      outcome: "pass",
      observations: {
        authentication: "verified",
        polling: "verified",
        exactHead: fixture.pull_request.head,
        status: statusId,
        aggregate: aggregateId,
        inline: inlineId,
        reconciliation: "idempotent",
      },
      failure: null,
    };
  } catch (error) {
    const failureCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.length <= 96 &&
      /^[a-z][a-z0-9_]*$/u.test(error.code)
        ? error.code
        : "private_github_canary_failed";
    return {
      ...common,
      fixture: fixtureValidated ? common.fixture : null,
      completedAt: new Date(now()).toISOString(),
      outcome: "fail",
      observations: null,
      failure: {
        code: failureCode,
        detail:
          redactOrdinaryDetail(
            error instanceof Error
              ? error.message
              : "private GitHub canary failed",
            { knownSecrets },
          ).slice(0, 512) || "private GitHub canary failed",
      },
    };
  }
}
