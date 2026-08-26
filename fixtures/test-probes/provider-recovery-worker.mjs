import { createIoExecutionPool } from "../../src/io-execution-pool.ts";
import { openDurableCore } from "../../src/durable/durable-core.ts";
import { createForgejoCommitStatusService } from "../../src/forgejo/forgejo-commit-status-service.ts";
import { createForgejoFeedbackService } from "../../src/forgejo/forgejo-feedback-service.ts";
import { createForgejoVerifier } from "../../src/forgejo/forgejo-verifier.ts";
import { createForgejoPollingService } from "../../src/forgejo/forgejo-polling.ts";
import { createGitHubCommitStatusService } from "../../src/github/github-commit-status-service.ts";
import { createGitHubFeedbackService } from "../../src/github/github-feedback-service.ts";
import { createGitHubVerifier } from "../../src/github/github-api.ts";
import { createGitHubPollingService } from "../../src/github/github-polling.ts";
import { createProviderHarness } from "./provider-recovery-provider.mjs";

const [provider, databasePath, nowValue] = process.argv.slice(2);
if (
  !["github", "forgejo"].includes(provider) ||
  typeof databasePath !== "string" ||
  !Number.isSafeInteger(Number(nowValue))
) {
  throw new TypeError("provider recovery worker arguments are invalid");
}

const now = Number(nowValue);
const core = openDurableCore(databasePath);
/** @type {string[]} */
const operations = [];
const externalStatePath = `${databasePath}.${provider}-external-state.json`;
const providerHarness = createProviderHarness({
  externalStatePath,
  now,
  operations,
  provider: /** @type {"github" | "forgejo"} */ (provider),
});
const providerVerifier = /** @type {any} */ (
  provider === "github"
    ? createGitHubVerifier({ fetch: providerHarness.fetch, now: () => now })
    : createForgejoVerifier({
        fetch: providerHarness.fetch,
        now: () => now,
      })
);

const services =
  provider === "github"
    ? [
        createGitHubFeedbackService(core, {
          cipher: { decrypt: () => providerHarness.credential },
          externalOrigin: "https://quality-bar.example",
          ioPool: createIoExecutionPool(),
          now: () => now,
          verifier: providerVerifier,
        }),
        createGitHubCommitStatusService(core, {
          cipher: { decrypt: () => providerHarness.credential },
          externalOrigin: "https://quality-bar.example",
          ioPool: createIoExecutionPool(),
          now: () => now,
          verifier: providerVerifier,
        }),
      ]
    : [
        createForgejoFeedbackService(core, {
          cipher: { decrypt: () => "pat" },
          externalOrigin: "https://quality-bar.example",
          ioPool: createIoExecutionPool(),
          now: () => now,
          verifier: providerVerifier,
        }),
        createForgejoCommitStatusService(core, {
          cipher: { decrypt: () => "pat" },
          externalOrigin: "https://quality-bar.example",
          ioPool: createIoExecutionPool(),
          now: () => now,
          verifier: providerVerifier,
        }),
      ];

let pollingFetches = 0;
let pollingError = null;
const polling =
  provider === "github"
    ? createGitHubPollingService(core, {
        fetchPullRequests: async ({ repository }) => {
          pollingFetches += 1;
          return providerVerifier.listPullRequests(
            providerHarness.credential,
            73,
            repository,
          );
        },
        now: () => now,
        recordOwningFailure() {},
      })
    : createForgejoPollingService(core, {
        fetchPullRequests: async ({ repository }) => {
          pollingFetches += 1;
          return providerVerifier.listPullRequests(
            { baseUrl: "https://forgejo.example", token: "pat" },
            repository,
          );
        },
        now: () => now,
        recordOwningFailure() {},
      });

try {
  for (const service of services) {
    await service.publishWaiting();
  }
  try {
    await polling.reconcile({
      connection: { id: "connection-1" },
      credential: {},
      repositories:
        provider === "github"
          ? [{ id: 101, full_name: "operator/repository" }]
          : [{ id: 101, full_name: "operator/repository" }],
    });
  } catch (error) {
    if (now >= 60_000) {
      throw error;
    }
    pollingError =
      error instanceof Error && "code" in error ? error.code : String(error);
  }
  const deliveryTable = `${provider}_delivery_attempts`;
  const deliveryGateTable = `${provider}_delivery_provider_gates`;
  const pollingTable = `${provider}_repository_polls`;
  const feedbackTable = `${provider}_feedback_bundles`;
  const statusTable = `${provider}_commit_statuses`;
  const statusColumns =
    provider === "github"
      ? "evaluation_id, desired_state, publication_status, error_code, error_detail"
      : "evaluation_id, desired_state, publication_status, external_id, error_code, error_detail";
  const statuses = core
    .all(`SELECT ${statusColumns} FROM ${statusTable}`)
    .map((row) =>
      provider === "github" ? { ...row, external_id: null } : row,
    );
  const deliveryGate =
    core.get(
      `SELECT gate_until, error_code, error_detail
         FROM ${deliveryGateTable}
        WHERE connection_id = 'connection-1'`,
    ) ?? null;
  const pollingGateRow =
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      `${provider}_poll_gate:connection-1`,
    ) ?? null;
  const pollingGate = pollingGateRow
    ? JSON.parse(/** @type {string} */ (pollingGateRow.value))
    : null;
  process.stdout.write(
    JSON.stringify({
      deliveries: core.all(
        `SELECT surface, source_id, attempt_count, error_code,
                error_detail, next_attempt_at, reconciliation_required,
                external_id
           FROM ${deliveryTable}
          WHERE source_id LIKE 'evaluation-%'
             OR source_id LIKE 'finding-%'
          ORDER BY surface, source_id`,
      ),
      deliveryGate,
      feedback: core.all(
        `SELECT evaluation_id, publication_status, external_id,
                error_code, error_detail
           FROM ${feedbackTable}`,
      ),
      inline: core.all(
        `SELECT finding_id, publication_status, external_id,
                error_code, error_detail
           FROM ${provider}_finding_feedback
          ORDER BY finding_id`,
      ),
      operations,
      pollingError,
      pollingFetches,
      pollingGate,
      statuses,
      pollingRow:
        core.get(
          `SELECT baseline_status, error_code, next_attempt_at,
                  error_message, rate_gate_until, snapshot
             FROM ${pollingTable}
            WHERE connection_id = 'connection-1' AND forge_repository_id = 101`,
        ) ?? null,
    }),
  );
} finally {
  for (const service of services) {
    service.destroy();
  }
  core.close();
}
