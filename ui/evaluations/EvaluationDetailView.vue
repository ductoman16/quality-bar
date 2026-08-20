<script setup>
import { nextTick, onMounted, onUnmounted, ref } from "vue";

import { csrfToken, responseMessage } from "../browser.js";
import EvaluationResult from "./EvaluationResult.vue";
import {
  isTerminalStatus,
  mutateEvaluation,
  nodeVisualState,
  validEvaluation,
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
let refreshing = false;
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
    if (response.status === 409) return;
    if (!response.ok) return showError(await responseMessage(response));
    const body = await response.json();
    if (!validEvaluationResult(body, evaluation.value.id)) throw new Error();
    result.value = body;
    resultEvaluationId = evaluation.value.id;
  } catch {
    await showError("Result failed to load");
  }
}
async function refresh() {
  if (refreshing || document.hidden) return;
  refreshing = true;
  try {
    const id = new URLSearchParams(location.search).get("evaluation_id");
    if (!id) {
      loading.value = false;
      await showError("An evaluation id is required");
      return;
    }
    const response = await fetch(
      `/api/v1/evaluations/${encodeURIComponent(id)}`,
    );
    loading.value = false;
    if (!response.ok) return showError(await responseMessage(response));
    const body = await response.json();
    if (!validEvaluation(body) || body.id !== id)
      return showError("Evaluation failed to load");
    evaluation.value = body;
    lastRefreshed.value = new Date().toLocaleTimeString();
    error.value = "";
    await loadResult();
  } catch {
    loading.value = false;
    await showError("Evaluation failed to load");
  } finally {
    refreshing = false;
  }
}
async function mutate(action) {
  if (!evaluation.value) return;
  busy.value = true;
  try {
    const response = await mutateEvaluation(
      action,
      evaluation.value.id,
      csrfToken(props.csrfCookieName),
    );
    if (!response.ok) await showError(await responseMessage(response));
    else await refresh();
  } catch {
    await showError("Evaluation action failed");
  } finally {
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
    <a class="qb-back" href="/?view=evaluations">Evaluations</a>
    <div v-if="evaluation" class="qb-evaluation-detail-meta">
      <h1>Evaluation {{ evaluation.id }}</h1>
      <dl>
        <dt>Repository</dt>
        <dd>{{ evaluation.repository.url }}</dd>
        <dt>Source</dt>
        <dd>{{ evaluation.provenance ?? "Unknown" }}</dd>
        <dt>Status</dt>
        <dd>{{ evaluation.execution_status }}</dd>
        <dt>Outcome</dt>
        <dd>{{ evaluation.effective_outcome }}</dd>
        <dt>Duration</dt>
        <dd>
          {{
            evaluation.monitor.duration_ms === null
              ? "In progress"
              : formatDuration(evaluation.monitor.duration_ms)
          }}
        </dd>
        <dt>Last refreshed</dt>
        <dd>{{ lastRefreshed }}</dd>
      </dl>
      <button
        v-if="['queued', 'running'].includes(evaluation.execution_status)"
        :disabled="busy"
        type="button"
        @click="mutate('cancel')"
      >
        Cancel
      </button>
      <button
        v-if="evaluation.retry_state === 'exhausted'"
        :disabled="busy"
        type="button"
        @click="mutate('retry')"
      >
        Retry
      </button>
    </div>
    <p v-if="loading">Loading Evaluation</p>
    <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
      {{ error }}
    </p>
    <section
      v-if="evaluation"
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
            >{{ node.kind === "review" ? "Review " : "" }}{{ node.label }}</span
          ><span>{{ statusLabel(node) }}</span
          ><span>{{
            Number.isSafeInteger(node.duration_ms)
              ? formatDuration(node.duration_ms)
              : "—"
          }}</span>
        </span>
      </template>
    </section>
    <EvaluationResult
      v-if="evaluation && result"
      :evaluation="evaluation"
      :result="result"
      @error="showError"
    />
    <p v-else-if="evaluation && isTerminalStatus(evaluation.execution_status)">
      Result unavailable
    </p>
  </section>
</template>
