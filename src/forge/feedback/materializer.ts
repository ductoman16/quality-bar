import { readEvaluationFindings } from "../../evaluation/evaluation-result-children.ts";
import { createIoDutyScheduler } from "../../io-execution-pool.ts";

const PUBLICATION_INTERVAL_MS = 1_000;

/**
 * Shared feedback-materialization pipeline for both forge adapters.
 *
 * Both GitHub and Forgejo run the same publication loop: reserve waiting
 * finding-feedback rows, walk every bundle whose aggregate or inline
 * feedback is still waiting, and deliver each surface. The forge-specific
 * pieces — SQL queries, per-forge finding materialization, HTTP call
 * shape, and per-forge delivery attempt bookkeeping — are supplied by the
 * adapter passed in `dependencies.adapter`.
 */
export function createForgeFeedbackMaterializer(
  durableCore: any,
  {
    cipher,
    externalOrigin,
    ioPool,
    now = () => Date.now(),
    verifier,
    adapter,
  }: {
    cipher: any;
    externalOrigin: string;
    ioPool: {
      run: (duty: "delivery", operation: () => unknown) => Promise<unknown>;
    };
    now?: () => number;
    verifier: any;
    adapter: {
      label: string;
      validateVerifier: (verifier: any) => void;
      sql: {
        missingMaterialization: string;
        bundles: string;
        inlineRows: string;
      };
      materializeFindingFeedback: (
        durableCore: any,
        bundle: any,
        findings: any[],
      ) => void;
      createAuthentication: (cipher: any, bundle: any) => () => any;
      formatAggregate: (identity: any, findings: any[]) => string;
      formatInline: (identity: any, finding: any) => string;
      attemptAggregateDelivery: (input: {
        durableCore: any;
        verifier: any;
        bundle: any;
        evaluationId: string;
        repository: { full_name: string; id: number };
        authentication: () => any;
        aggregateTarget: any;
        now: () => number;
      }) => Promise<unknown>;
      attemptFindingDelivery: (input: {
        durableCore: any;
        verifier: any;
        bundle: any;
        row: any;
        repository: { full_name: string; id: number };
        authentication: () => any;
        inlineTarget: any;
        now: () => number;
      }) => Promise<unknown>;
    };
  },
) {
  const label = adapter?.label;
  if (
    typeof label !== "string" ||
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof cipher?.decrypt !== "function" ||
    typeof ioPool?.run !== "function" ||
    typeof now !== "function" ||
    typeof adapter?.validateVerifier !== "function" ||
    typeof adapter?.materializeFindingFeedback !== "function" ||
    typeof adapter?.createAuthentication !== "function" ||
    typeof adapter?.formatAggregate !== "function" ||
    typeof adapter?.formatInline !== "function" ||
    typeof adapter?.attemptAggregateDelivery !== "function" ||
    typeof adapter?.attemptFindingDelivery !== "function" ||
    typeof adapter?.sql?.missingMaterialization !== "string" ||
    typeof adapter?.sql?.bundles !== "string" ||
    typeof adapter?.sql?.inlineRows !== "string"
  ) {
    throw new TypeError(
      `${label ?? "Forge"} feedback dependencies are invalid`,
    );
  }
  adapter.validateVerifier(verifier);
  const origin = new URL(externalOrigin);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new TypeError(`${label} feedback requires an HTTP origin`);
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function detailsUrl(evaluationId: string) {
    const target = new URL("/", origin);
    target.searchParams.set("view", "evaluations");
    target.searchParams.set("evaluation_id", evaluationId);
    return target.toString();
  }

  async function publishWaiting() {
    if (running) {
      return;
    }
    running = true;
    try {
      const missingFindingFeedback = durableCore.all(
        adapter.sql.missingMaterialization,
      );
      for (const bundle of missingFindingFeedback) {
        const evaluationId = bundle?.evaluation_id as string;
        adapter.materializeFindingFeedback(
          durableCore,
          bundle,
          readEvaluationFindings(durableCore, evaluationId),
        );
      }
      const bundles = durableCore.all(adapter.sql.bundles);
      for (const bundle of bundles) {
        const evaluationId = bundle.evaluation_id as string;
        const findings = readEvaluationFindings(durableCore, evaluationId);
        adapter.materializeFindingFeedback(durableCore, bundle, findings);
        const identity = {
          base_commit: bundle.base_commit as string,
          details_url: detailsUrl(evaluationId),
          evaluation_id: evaluationId,
          head_commit: bundle.head_commit as string,
          outcome: bundle.outcome as string,
        };
        const repository = {
          full_name: bundle.name as string,
          id: bundle.forge_repository_id as number,
        };
        const authentication = adapter.createAuthentication(cipher, bundle);
        if (bundle.publication_status === "waiting") {
          const aggregateTarget = {
            body: adapter.formatAggregate(identity, findings as any[]),
            pull_request_number: bundle.pull_request_number,
            repository_id: bundle.forge_repository_id,
          };
          await adapter.attemptAggregateDelivery({
            durableCore,
            verifier,
            bundle,
            evaluationId,
            repository,
            authentication,
            aggregateTarget,
            now,
          });
        }
        const inlineRows = durableCore.all(
          adapter.sql.inlineRows,
          evaluationId,
        );
        for (const row of inlineRows) {
          const comment = {
            body: adapter.formatInline(identity, {
              evidence: row?.evidence as string,
              id: row?.finding_id as string,
              impact: row?.impact as string,
              remediation: row?.remediation as string,
            }),
            commit_id: identity.head_commit,
            line: row?.line as number,
            path: row?.path as string,
            side: row?.side as "LEFT" | "RIGHT",
            ...(row?.start_line === null
              ? {}
              : {
                  start_line: row?.start_line as number,
                  start_side: row?.start_side as "LEFT" | "RIGHT",
                }),
          };
          const inlineTarget = {
            ...comment,
            pull_request_number: bundle.pull_request_number,
            repository_id: bundle.forge_repository_id,
          };
          await adapter.attemptFindingDelivery({
            durableCore,
            verifier,
            bundle,
            row,
            repository,
            authentication,
            inlineTarget,
            now,
          });
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
