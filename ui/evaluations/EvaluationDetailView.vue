<script setup>
import { nextTick, onMounted, onUnmounted, ref } from "vue";

import {
  csrfToken,
  requireStatus,
  responseError,
  responseMessage,
} from "../browser.js";
import EvaluationResult from "./EvaluationResult.vue";
import {
  mutateEvaluation,
  isTerminalStatus,
  nodeVisualState,
  validEvaluation,
  validEvaluationMutation,
  validEvaluationResult,
} from "./contract.js";
import { formatDuration } from "./duration.js";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const evaluation = ref(null);
const result = ref(null);
const loading = ref(true);
const error = ref("");
const errorElement = ref();
const busy = ref(false);
const lastRefreshed = ref("");
let refreshPromise;
let resultEvaluationId = null;
let timer;

const showError = async (message) => {
  error.value = message;
  await nextTick();
  errorElement.value?.focus();
};
const statusLabel = (node) => {
  const value =
    node.kind === "review" && node.outcome ? node.outcome : node.status;
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
};
const selector = (value, commit) => `${value.type} ${value.value} · ${commit}`;
const duration = (value) =>
  value.monitor.duration_ms === null
    ? isTerminalStatus(value.execution_status)
      ? "Unavailable"
      : "In progress"
    : formatDuration(value.monitor.duration_ms);
const feedback = (value) => {
  if (!value) return "Not applicable";
  const statuses = value.findings.map((item) => item.publication_status);
  return `Aggregate ${value.aggregate.publication_status}; findings ${statuses.join(", ") || "none"}`;
};
async function loadResult() {
  if (
    !evaluation.value ||
    !["completed", "failed"].includes(evaluation.value.execution_status)
  ) {
    result.value = null;
    resultEvaluationId = null;
    return;
  }
  if (result.value && resultEvaluationId === evaluation.value.id) return;
  try {
    const response = await fetch(
      `/api/v1/evaluations/${encodeURIComponent(evaluation.value.id)}/result`,
    );
    if (response.status === 409) {
      const failure = await responseError(response);
      if (failure.code === "evaluation_result_not_ready") return;
      throw new Error(failure.message);
    }
    await requireStatus(response, 200, "evaluation_result_response_invalid");
    const body = await response.json();
    if (!validEvaluationResult(body, evaluation.value.id))
      throw new Error("evaluation_result_invalid");
    result.value = body;
    resultEvaluationId = evaluation.value.id;
  } catch (failure) {
    await showError(
      failure instanceof Error ? failure.message : "Result failed to load",
    );
  }
}
async function loadEvaluation() {
  try {
    const id = new URLSearchParams(location.search).get("evaluation_id");
    if (!id) {
      loading.value = false;
      evaluation.value = result.value = null;
      await showError("An evaluation id is required");
      return false;
    }
    const response = await fetch(
      `/api/v1/evaluations/${encodeURIComponent(id)}`,
    );
    loading.value = false;
    await requireStatus(response, 200, "evaluation_response_invalid");
    const body = await response.json();
    if (!validEvaluation(body) || body.id !== id)
      throw new Error("Evaluation failed to load");
    evaluation.value = body;
    lastRefreshed.value = new Date().toLocaleTimeString();
    error.value = "";
    await loadResult();
    return true;
  } catch (failure) {
    loading.value = false;
    evaluation.value = result.value = null;
    await showError(
      failure instanceof Error ? failure.message : "Evaluation failed to load",
    );
    return false;
  }
}
function refresh(force = false) {
  if (document.hidden && !force) return Promise.resolve(null);
  if (refreshPromise) {
    return force ? refreshPromise.then(() => refresh(true)) : refreshPromise;
  }
  refreshPromise = loadEvaluation().finally(() => (refreshPromise = null));
  return refreshPromise;
}
async function mutate(action) {
  if (!evaluation.value) return;
  busy.value = true;
  let failureMessage = "";
  try {
    const response = await mutateEvaluation(
      action,
      evaluation.value.id,
      csrfToken(props.csrfCookieName),
    );
    if (!response.ok) {
      failureMessage = await responseMessage(response);
    } else {
      const body = await response.json();
      if (
        response.status !== 200 ||
        !validEvaluationMutation(body, evaluation.value.id, action)
      ) {
        failureMessage = "evaluation_response_invalid";
      }
    }
  } catch (failure) {
    failureMessage =
      failure instanceof Error ? failure.message : "Evaluation action failed";
  } finally {
    const refreshed = await refresh(true);
    if (failureMessage) {
      await showError(
        refreshed === false
          ? `${failureMessage}; ${error.value}`
          : failureMessage,
      );
    }
    busy.value = false;
  }
}
const visibility = () => {
  clearInterval(timer);
  if (!document.hidden) {
    void refresh();
    timer = setInterval(refresh, 5_000);
  }
};
onMounted(() => {
  void refresh();
  document.addEventListener("visibilitychange", visibility);
  visibility();
});
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener("visibilitychange", visibility);
});
</script>

<template>
  <section id="evaluation-detail">
    <a id="evaluation-detail-back" class="qb-back" href="/?view=evaluations"
      >Evaluations</a
    >
    <div v-if="evaluation" class="qb-evaluation-detail-meta">
      <h2 id="evaluation-detail-title">Evaluation {{ evaluation.id }}</h2>
      <dl>
        <dt>Repository</dt>
        <dd id="evaluation-detail-repository">
          {{ evaluation.repository.url }}
        </dd>
        <dt>Source</dt>
        <dd id="evaluation-detail-source">
          {{ evaluation.provenance }}
        </dd>
        <dt>Base</dt>
        <dd>
          {{ selector(evaluation.base_selector, evaluation.base_commit) }}
        </dd>
        <dt>Head</dt>
        <dd>
          {{ selector(evaluation.head_selector, evaluation.head_commit) }}
        </dd>
        <dt>Pull request</dt>
        <dd>{{ evaluation.pull_request?.number ?? "Not applicable" }}</dd>
        <dt>Status</dt>
        <dd id="evaluation-detail-status">{{ evaluation.execution_status }}</dd>
        <dt>Outcome</dt>
        <dd id="evaluation-detail-outcome">
          {{ evaluation.effective_outcome }}
        </dd>
        <dt>Duration</dt>
        <dd id="evaluation-detail-duration">
          {{ duration(evaluation) }}
        </dd>
        <dt>Commit status</dt>
        <dd>
          {{
            evaluation.commit_status
              ? `${evaluation.commit_status.state} · ${evaluation.commit_status.publication_status}`
              : "Not applicable"
          }}
        </dd>
        <dt>Feedback</dt>
        <dd>{{ feedback(evaluation.feedback) }}</dd>
        <dt>Last refreshed</dt>
        <dd id="evaluation-detail-updated">{{ lastRefreshed }}</dd>
      </dl>
      <button
        v-if="['queued', 'running'].includes(evaluation.execution_status)"
        id="evaluation-detail-cancel"
        :disabled="busy"
        type="button"
        @click="mutate('cancel')"
      >
        Cancel
      </button>
      <button
        v-if="evaluation.retry_state === 'exhausted'"
        id="evaluation-detail-retry"
        :disabled="busy"
        type="button"
        @click="mutate('retry')"
      >
        Retry
      </button>
    </div>
    <p v-if="loading" id="evaluation-detail-loading">Loading Evaluation</p>
    <p
      v-if="error"
      id="evaluation-detail-error"
      ref="errorElement"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
    </p>
    <div
      v-if="evaluation"
      id="evaluation-detail-preview"
      class="qb-deep-surface evaluation-detail-preview"
    >
      <section
        id="evaluation-detail-timeline"
        class="qb-timeline evaluation-detail-timeline"
        aria-label="Evaluation steps"
      >
        <template
          v-for="(node, index) in evaluation.monitor.nodes"
          :key="node.key ?? node.review_version_id"
        >
          <span v-if="index" class="qb-timeline-connector"></span>
          <span
            :class="`qb-timeline-node qb-timeline-node--${node.kind} qb-timeline-node--${nodeVisualState(node)}`"
            :aria-label="`${node.label}: ${statusLabel(node)}`"
          >
            <span aria-hidden="true" class="qb-timeline-node__marker"></span>
            <span
              >{{ node.kind === "review" ? "Review " : ""
              }}{{ node.label }}</span
            ><span>{{ statusLabel(node) }}</span
            ><span>—</span>
          </span>
        </template>
      </section>
      <aside aria-label="Outcome summary">
        <h2>Outcome summary</h2>
        <dl>
          <dt>Review Runs</dt>
          <dd>
            {{ evaluation.monitor.review_counts.completed }} completed ·
            {{ evaluation.monitor.review_counts.running }} running ·
            {{ evaluation.monitor.review_counts.failed }} failed ·
            {{ evaluation.monitor.review_counts.cancelled }} cancelled ·
            {{ evaluation.monitor.review_counts.total }} total
          </dd>
          <dt>Review outcomes</dt>
          <dd v-if="evaluation.monitor.outcome_counts">
            {{ evaluation.monitor.outcome_counts.clear }} clear ·
            {{ evaluation.monitor.outcome_counts.triggered }} triggered ·
            {{ evaluation.monitor.outcome_counts.not_applicable }} not
            applicable · {{ evaluation.monitor.outcome_counts.error }} error
          </dd>
          <dd v-else>Unavailable</dd>
          <dt>Findings</dt>
          <dd v-if="evaluation.monitor.finding_counts">
            {{ evaluation.monitor.finding_counts.advisory }} advisory ·
            {{ evaluation.monitor.finding_counts.blocking }} blocking ·
            {{ evaluation.monitor.finding_counts.total }} total
          </dd>
          <dd v-else>Unavailable</dd>
        </dl>
      </aside>
    </div>
    <EvaluationResult
      v-if="evaluation && result"
      id="evaluation-detail-result"
      :evaluation="evaluation"
      :result="result"
      @error="showError"
    />
  </section>
</template>
