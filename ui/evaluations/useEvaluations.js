import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  csrfToken,
  repositoryCollection,
  requireStatus,
  responseMessage,
} from "../browser.js";
import {
  mutateEvaluation,
  validCollection,
  validEvaluation,
  validEvaluationMutation,
} from "./contract.js";
const FILTER_NAMES = [
  "repository_id",
  "execution_status",
  "effective_outcome",
  "query",
  "start",
  "end",
];
const timestamp = (evaluation) =>
  new Date(evaluation.created_at).getTime() || 0;
const newestFirst = (left, right) =>
  timestamp(right) - timestamp(left) || right.id.localeCompare(left.id);
const signature = (evaluation) =>
  JSON.stringify([
    evaluation.execution_status,
    evaluation.effective_outcome,
    evaluation.retry_state,
    evaluation.monitor.nodes.map((node) => [
      node.kind,
      node.status,
      node.outcome,
    ]),
  ]);
const localDateTime = (value) => {
  if (!/^\d+$/.test(value ?? "")) {
    return "";
  }
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const epoch = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : "";
};
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const validStatsSystem = (value) =>
  count(value?.codex_execution?.concurrency?.maximum_running) &&
  count(value.codex_execution.concurrency.running_count) &&
  count(value.codex_execution.queue?.count);
const validStatsAnalytics = (value) =>
  count(value?.evaluation_overview?.clear_rate?.numerator) &&
  count(value.evaluation_overview.clear_rate.denominator) &&
  (value.evaluation_overview.p95_duration_ms === null ||
    count(value.evaluation_overview.p95_duration_ms));
export function useEvaluations(csrfCookieName) {
  const evaluations = ref([]);
  const repositories = ref([]);
  const expanded = reactive(new Set());
  const loading = ref(true);
  const listError = ref("");
  const statsError = ref("");
  const error = computed(() => listError.value || statsError.value);
  const nextCursor = ref(null);
  const newActivity = ref(false);
  const createOpen = ref(false);
  const createStatus = ref("");
  const statsWindow = ref(24);
  const stats = reactive({
    clearRate: "Loading",
    p95: "Loading",
    queue: "Loading",
    updated: "Loading",
    workers: "Loading",
  });
  const filters = reactive(
    Object.fromEntries(FILTER_NAMES.map((name) => [name, ""])),
  );
  const create = reactive({
    baseType: "branch",
    baseValue: "",
    headType: "branch",
    headValue: "",
    repositoryId: "",
  });
  const known = new Map();
  let firstResponse = true;
  let timer = null;
  const groups = computed(() => {
    const grouped = new Map();
    for (const evaluation of evaluations.value) {
      const key = new Date(timestamp(evaluation)).toLocaleDateString();
      const group = grouped.get(key) ?? [];
      group.push(evaluation);
      grouped.set(key, group);
    }
    return [...grouped.values()]
      .map((group) => group.sort(newestFirst))
      .sort((left, right) => newestFirst(left[0], right[0]));
  });

  const repositoryById = (id) =>
    repositories.value.find((repository) => repository.id === id);
  const parameters = () => {
    const result = new URLSearchParams({ limit: "50" });
    for (const name of FILTER_NAMES) {
      const value = ["start", "end"].includes(name)
        ? epoch(filters[name])
        : filters[name];
      if (value) {
        result.set(name, value);
      }
    }
    return result;
  };
  const setFiltersFromLocation = () => {
    const search = new URLSearchParams(location.search);
    for (const name of FILTER_NAMES) {
      const value = search.get(name) ?? "";
      filters[name] = ["start", "end"].includes(name)
        ? localDateTime(value)
        : value;
    }
  };
  const replaceFilterUrl = () => {
    const search = parameters();
    search.delete("limit");
    search.set("view", "evaluations");
    history.replaceState(null, "", `/?${search}`);
  };
  const showFailure = async (response) => {
    listError.value = await responseMessage(response);
  };
  async function refresh({
    cursor = null,
    poll = false,
    replace = false,
  } = {}) {
    if (!poll) {
      loading.value = cursor === null;
    }
    const search = parameters();
    if (cursor) {
      search.set("cursor", cursor);
    }
    let collection;
    try {
      const response = await fetch(`/api/v1/evaluations?${search}`);
      await requireStatus(response, 200, "evaluation_collection_invalid");
      collection = await response.json();
      if (!validCollection(collection)) {
        throw new Error("Evaluations returned an invalid response");
      }
    } catch (failure) {
      loading.value = false;
      listError.value =
        failure instanceof Error
          ? failure.message
          : "Evaluations failed to load";
      return;
    }
    loading.value = false;
    listError.value = "";
    if (poll) {
      const changed = collection.items.some(
        (evaluation) =>
          !known.has(evaluation.id) ||
          signature(known.get(evaluation.id)) !== signature(evaluation),
      );
      collection.items.forEach((evaluation) =>
        known.set(evaluation.id, evaluation),
      );
      if (!firstResponse && changed) {
        newActivity.value = true;
      }
      firstResponse = false;
      return;
    }
    const items = collection.items.slice().sort(newestFirst);
    items.forEach((evaluation) => known.set(evaluation.id, evaluation));
    evaluations.value =
      cursor && !replace
        ? [
            ...evaluations.value,
            ...items.filter(
              (item) => !evaluations.value.some(({ id }) => id === item.id),
            ),
          ]
        : items;
    nextCursor.value = collection.next_cursor;
    firstResponse = false;
  }

  async function refreshStats(hours = statsWindow.value) {
    statsWindow.value = hours;
    const now = Date.now();
    try {
      const [system, analytics] = await Promise.all([
        fetch("/api/v1/system"),
        fetch(`/api/v1/analytics?start=${now - hours * 3_600_000}&end=${now}`),
      ]);
      await requireStatus(system, 200, "evaluation_statistics_invalid");
      await requireStatus(analytics, 200, "evaluation_statistics_invalid");
      const [systemBody, analyticsBody] = await Promise.all([
        system.json(),
        analytics.json(),
      ]);
      if (
        !validStatsSystem(systemBody) ||
        !validStatsAnalytics(analyticsBody)
      ) {
        throw new Error("evaluation_statistics_invalid");
      }
      const concurrency = systemBody.codex_execution.concurrency;
      stats.workers = `${concurrency.running_count} / ${concurrency.maximum_running}`;
      stats.queue = String(systemBody.codex_execution.queue.count);
      const overview = analyticsBody.evaluation_overview;
      const { numerator, denominator } = overview.clear_rate;
      stats.clearRate = denominator
        ? `${((numerator / denominator) * 100).toFixed(1)}%`
        : "No data";
      stats.p95 = Number.isSafeInteger(overview.p95_duration_ms)
        ? `${overview.p95_duration_ms} ms`
        : "No data";
      stats.updated = "Just now";
      statsError.value = "";
    } catch (failure) {
      statsError.value =
        failure instanceof Error
          ? failure.message
          : "Evaluation statistics failed to load";
    }
  }

  async function submitCreate() {
    createStatus.value = "";
    const valid = (type, value) =>
      type === "branch"
        ? value.trim()
        : /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
    if (
      !valid(create.baseType, create.baseValue) ||
      !valid(create.headType, create.headValue)
    ) {
      createStatus.value =
        "Branch values must be non-empty. Commit values must be 40 or 64 lowercase hexadecimal characters.";
      return;
    }
    try {
      const response = await fetch(
        `/api/v1/repositories/${encodeURIComponent(create.repositoryId)}/evaluations`,
        {
          body: JSON.stringify({
            base: { type: create.baseType, value: create.baseValue },
            head: { type: create.headType, value: create.headValue },
          }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
            "x-quality-bar-csrf": csrfToken(csrfCookieName),
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        return showFailure(response);
      }
      const created = await response.json();
      if (
        response.status !== 201 ||
        !validEvaluation(created) ||
        created.repository.id !== create.repositoryId
      ) {
        throw new Error("evaluation_response_invalid");
      }
      createStatus.value = `Evaluation ${created.id} requested.`;
      await Promise.all([refresh({ replace: true }), refreshStats()]);
    } catch (failure) {
      createStatus.value = listError.value =
        failure instanceof Error
          ? failure.message
          : "Evaluation request failed";
    }
  }

  async function mutate(evaluation, action) {
    let failureMessage = "";
    try {
      const response = await mutateEvaluation(
        action,
        evaluation.id,
        csrfToken(csrfCookieName),
      );
      if (!response.ok) {
        failureMessage = await responseMessage(response);
      } else {
        const body = await response.json();
        if (
          response.status !== 200 ||
          !validEvaluationMutation(body, evaluation.id, action)
        ) {
          failureMessage = "evaluation_response_invalid";
        }
      }
    } catch (failure) {
      failureMessage =
        failure instanceof Error ? failure.message : "Evaluation action failed";
    }
    await Promise.all([refresh({ replace: true }), refreshStats()]);
    if (failureMessage) {
      listError.value = failureMessage;
    }
  }
  async function revealActivity() {
    await refresh({ replace: true });
    newActivity.value = false;
  }
  async function applyFilters() {
    replaceFilterUrl();
    expanded.clear();
    await refresh({ replace: true });
  }
  async function resetFilters() {
    FILTER_NAMES.forEach((name) => (filters[name] = ""));
    await applyFilters();
  }
  const visibility = () => {
    clearInterval(timer);
    timer = null;
    if (!document.hidden) {
      void refresh({ poll: true });
      void refreshStats();
      timer = setInterval(() => {
        void refresh({ poll: true });
        void refreshStats();
      }, 5_000);
    }
  };
  const popstate = () => {
    setFiltersFromLocation();
    void refresh({ replace: true });
  };
  onMounted(async () => {
    setFiltersFromLocation();
    try {
      repositories.value = await repositoryCollection();
      create.repositoryId = repositories.value[0]?.id ?? "";
    } catch (failure) {
      listError.value =
        failure instanceof Error
          ? failure.message
          : "Repositories failed to load";
    }
    await Promise.all([refreshStats(24), refresh({ replace: true })]);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("popstate", popstate);
    visibility();
  });
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("popstate", popstate);
  });
  return {
    applyFilters,
    create,
    createOpen,
    createStatus,
    error,
    evaluations,
    expanded,
    filters,
    groups,
    loading,
    mutate,
    newActivity,
    nextCursor,
    refresh,
    refreshStats,
    repositoryById,
    repositories,
    resetFilters,
    revealActivity,
    stats,
    statsWindow,
    submitCreate,
  };
}
