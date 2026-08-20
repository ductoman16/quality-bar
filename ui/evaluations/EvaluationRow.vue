<script setup>
import { computed } from "vue";

import { isTerminalStatus, nodeVisualState } from "./contract.js";
import { formatDuration } from "./duration.js";

const props = defineProps({
  evaluation: { required: true, type: Object },
  expanded: Boolean,
  repository: Object,
});
defineEmits(["mutate", "toggle"]);

const text = (value) => (typeof value === "string" ? value : "");
const timestamp = computed(() =>
  new Date(props.evaluation.created_at).getTime(),
);
const duration = computed(() => {
  const value = props.evaluation.monitor?.duration_ms;
  if (Number.isSafeInteger(value) && value >= 0) return formatDuration(value);
  if (!isTerminalStatus(props.evaluation.execution_status)) {
    return formatDuration(Math.max(0, Date.now() - timestamp.value));
  }
  return "—";
});
const evaluationUrl = computed(
  () =>
    `/?view=evaluation-detail&evaluation_id=${encodeURIComponent(props.evaluation.id)}`,
);
const repositoryLabel = computed(() => {
  const last = text(props.evaluation.repository?.url).replace(/^.*\//, "");
  return (
    last.replace(/\.git$/i, "") ||
    props.evaluation.repository?.id ||
    "Repository"
  );
});
const short = (value) =>
  /^[0-9a-f]{12,}$/.test(value) ? value.slice(0, 7) : value || "—";
const commitUrl = (commit) =>
  props.repository?.web_url && /^[0-9a-f]{40,64}$/.test(commit)
    ? `${props.repository.web_url.replace(/\/$/, "")}/commit/${commit}`
    : "";
const pullRequest = computed(() =>
  props.evaluation.provenance === "automatic" &&
  Number.isSafeInteger(props.evaluation.pull_request?.number)
    ? props.evaluation.pull_request.number
    : null,
);
const pullRequestUrl = computed(() =>
  pullRequest.value && props.repository?.web_url
    ? `${props.repository.web_url.replace(/\/$/, "")}/${props.repository.provider === "github" ? "pull" : "pulls"}/${pullRequest.value}`
    : "",
);
const status = computed(() => {
  const execution = {
    cancelled: ["Cancelled", "cancelled"],
    failed: ["Failed", "failed"],
    queued: ["Queued", "pending"],
    running: ["Running", "active"],
  }[props.evaluation.execution_status];
  const outcome = props.evaluation.effective_outcome;
  return execution ?? [outcome[0].toUpperCase() + outcome.slice(1), outcome];
});
const nodeStatus = (node) => {
  const outcome = node.kind === "review" ? node.outcome : null;
  if (outcome && outcome !== "pending") {
    return [outcome, outcome[0].toUpperCase() + outcome.slice(1)];
  }
  const [tone, label] = {
    cancelled: ["cancelled", "Cancelled"],
    completed: ["clear", "Completed"],
    failed: ["error", "Failed"],
    queued: ["pending", "Queued"],
    running: ["active", "Running"],
  }[node.status] ?? ["pending", "Unknown"];
  return [tone, label];
};
const localTime = (value) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
</script>

<template>
  <article class="evaluation-row" :data-evaluation-id="evaluation.id">
    <div class="evaluation-row__summary">
      <button
        class="evaluation-row__toggle"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="`evaluation-expanded-${evaluation.id}`"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} evaluation ${evaluation.id}`"
        @click="$emit('toggle')"
      >
        <span class="evaluation-row__chevron"></span>
      </button>
      <a class="evaluation-row__time" :href="evaluationUrl">{{
        localTime(timestamp)
      }}</a>
      <a
        class="evaluation-row__repository"
        :href="`/?view=repository-detail&repository_id=${encodeURIComponent(evaluation.repository.id)}`"
        >{{ repositoryLabel }}</a
      >
      <span class="evaluation-row__source">
        <a
          v-if="commitUrl(evaluation.base_commit)"
          class="evaluation-row__source-commit"
          :href="commitUrl(evaluation.base_commit)"
          rel="noopener"
          target="_blank"
          >{{ short(evaluation.base_commit) }}</a
        >
        <span v-else class="evaluation-row__source-commit">{{
          short(evaluation.base_commit)
        }}</span>
        <a
          v-if="commitUrl(evaluation.head_commit)"
          class="evaluation-row__source-commit"
          :href="commitUrl(evaluation.head_commit)"
          rel="noopener"
          target="_blank"
          >{{ short(evaluation.head_commit) }}</a
        >
        <span v-else class="evaluation-row__source-commit">{{
          short(evaluation.head_commit)
        }}</span>
        <a
          v-if="pullRequestUrl"
          class="evaluation-row__source-pull-request"
          :href="pullRequestUrl"
          rel="noopener"
          target="_blank"
          >PR #{{ pullRequest }}</a
        >
      </span>
      <a
        :class="`evaluation-row__outcome evaluation-status--${status[1]}`"
        :href="evaluationUrl"
      >
        <span class="evaluation-status__icon"></span
        ><span>{{ status[0] }}</span>
      </a>
      <span class="evaluation-row__duration">{{ duration }}</span>
    </div>
    <div
      class="qb-timeline evaluation-row__timeline"
      aria-label="Step progress"
    >
      <template
        v-for="(node, index) in evaluation.monitor.nodes"
        :key="node.key ?? node.review_version_id"
      >
        <span v-if="index" class="qb-timeline-connector"></span>
        <span
          :class="`qb-timeline-node qb-timeline-node--${node.kind} qb-timeline-node--${nodeVisualState(node)}`"
          :aria-label="`${node.label}: ${nodeStatus(node)[1]}`"
          :title="`${node.label}: ${nodeStatus(node)[1]}`"
        ></span>
      </template>
    </div>
    <div
      v-if="['queued', 'running'].includes(evaluation.execution_status)"
      class="evaluation-actions"
    >
      <button
        class="qb-btn qb-btn--secondary qb-btn--compact"
        type="button"
        @click="$emit('mutate', 'cancel')"
      >
        Cancel
      </button>
      <button
        v-if="
          evaluation.execution_status === 'queued' &&
          evaluation.retry_state === 'exhausted'
        "
        class="qb-btn qb-btn--secondary qb-btn--compact"
        type="button"
        @click="$emit('mutate', 'retry')"
      >
        Retry
      </button>
    </div>
    <a
      class="evaluation-row__detail"
      :href="evaluationUrl"
      :aria-label="`Open evaluation ${evaluation.id}`"
      >›</a
    >
    <section
      v-if="expanded"
      :id="`evaluation-expanded-${evaluation.id}`"
      class="evaluation-expanded"
    >
      <div class="evaluation-expanded__table">
        <div class="evaluation-expanded__row evaluation-expanded__row--header">
          <span>Step</span><span>Status</span><span>Duration</span
          ><span>Finished</span>
        </div>
        <div
          v-for="(node, index) in evaluation.monitor.nodes"
          :key="node.key ?? node.review_version_id"
          class="evaluation-expanded__row evaluation-node"
        >
          <div class="evaluation-step">
            <span class="evaluation-step__number">{{ index + 1 }}</span
            ><span>{{ node.label }}</span>
          </div>
          <span
            :class="`evaluation-node-status evaluation-status--${nodeStatus(node)[0]}`"
            ><span class="evaluation-status__icon"></span
            ><span>{{ nodeStatus(node)[1] }}</span></span
          >
          <span>—</span>
          <time>—</time>
        </div>
      </div>
    </section>
  </article>
</template>
