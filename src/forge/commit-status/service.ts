import { createIoDutyScheduler } from "../../io-execution-pool.ts";
import { readEffectiveWaiverOutcome } from "../../waiver/waiver-followup-outcome.ts";
import { COMMIT_STATUS_CONTEXT, commitStatusForEvaluation } from "./status.ts";

const PUBLICATION_INTERVAL_MS = 1_000;

/**
 * Shared commit-status publication skeleton for both forge adapters.
 *
 * Both GitHub and Forgejo scan a table of waiting commit statuses, resolve
 * the effective waiver outcome for each, derive a `Quality Bar` commit
 * status target, and hand each row to a forge-specific delivery adapter
 * that owns the HTTP call plus the retry/gate/recovery envelope updates.
 */
export function createForgeCommitStatusService(
  durableCore: any,
  {
    externalOrigin,
    ioPool,
    now = () => Date.now(),
    provider,
    fetchWaitingRows,
    dedupSources = false,
    attemptDelivery,
  }: {
    externalOrigin: string;
    ioPool: {
      run: (duty: "delivery", operation: () => unknown) => Promise<unknown>;
    };
    now?: () => number;
    provider: "GitHub" | "Forgejo";
    fetchWaitingRows: (durableCore: any) => any[];
    dedupSources?: boolean;
    attemptDelivery: (
      durableCore: any,
      context: {
        row: any;
        status: { description: string; state: string };
        statusTarget: {
          description: string;
          head: string;
          state: string;
          targetUrl: string;
        };
        target: string;
        now: () => number;
      },
    ) => Promise<unknown>;
  },
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.get !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof fetchWaitingRows !== "function" ||
    typeof attemptDelivery !== "function" ||
    (provider !== "GitHub" && provider !== "Forgejo")
  ) {
    throw new TypeError(
      `${provider ?? "Forge"} commit status dependencies are invalid`,
    );
  }
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError(`${provider} commit status requires an HTTP origin`);
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      const attemptedSources = dedupSources ? new Set() : null;
      while (true) {
        const rows = fetchWaitingRows(durableCore);
        const filtered = attemptedSources
          ? rows.filter(
              (row: any) =>
                !attemptedSources.has(
                  `${row.evaluation_id}:${row.desired_state}`,
                ),
            )
          : rows;
        if (filtered.length === 0) {
          break;
        }
        for (const row of filtered) {
          if (attemptedSources) {
            attemptedSources.add(`${row.evaluation_id}:${row.desired_state}`);
          }
          const outcome = readEffectiveWaiverOutcome(
            durableCore,
            row.evaluation_id,
          );
          const status = commitStatusForEvaluation(outcome);
          if (status.state !== row.desired_state) {
            throw new TypeError(
              `${provider} commit status durable state is invalid`,
            );
          }
          const targetUrl = new URL("/", origin);
          targetUrl.searchParams.set("view", "evaluations");
          targetUrl.searchParams.set(
            "evaluation_id",
            row.evaluation_id as string,
          );
          const statusTarget = {
            description: status.description,
            head: row.head_commit as string,
            state: status.state,
            targetUrl: targetUrl.toString(),
          };
          const target = JSON.stringify({
            context: COMMIT_STATUS_CONTEXT,
            description: status.description,
            head: row.head_commit,
            repository_id: row.forge_repository_id,
            state: row.desired_state,
            target_url: statusTarget.targetUrl,
          });
          await attemptDelivery(durableCore, {
            row,
            status,
            statusTarget,
            target,
            now,
          });
        }
        if (!attemptedSources) {
          break;
        }
      }
    } finally {
      running = false;
    }
  }

  const schedulePublication = createIoDutyScheduler(
    ioPool,
    "delivery",
    publishWaiting,
  );

  return {
    destroy() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      schedulePublication.cancel();
    },
    publishWaiting,
    start() {
      if (timer) {
        return;
      }
      schedulePublication.background();
      timer = setInterval(
        schedulePublication.background,
        PUBLICATION_INTERVAL_MS,
      );
      timer.unref?.();
    },
  };
}
