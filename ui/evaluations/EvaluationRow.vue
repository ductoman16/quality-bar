<script setup>
import {
  FonoButton,
  FonoIconButton,
  FonoStatusMark,
  FonoTimeline,
} from "fono-ui";
import { computed } from "vue";

import { isTerminalStatus, nodeVisualState } from "./contract.ts";
import { formatDuration } from "./duration.ts";

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
    failed: ["Failed", "error"],
    queued: ["Queued", "pending"],
    running: ["Running", "active"],
  }[props.evaluation.execution_status];
  const outcome = props.evaluation.effective_outcome;
  return (
    execution ?? [
      outcome[0].toUpperCase() + outcome.slice(1),
      {
        advisory: "attention",
        blocking: "blocked",
        clear: "complete",
        error: "error",
        pending: "pending",
      }[outcome],
    ]
  );
});
const nodeStatus = (node) => {
  const outcome = node.kind === "review" ? node.outcome : null;
  if (outcome && outcome !== "pending") {
    return [
      {
        advisory: "attention",
        blocking: "blocked",
        clear: "complete",
        error: "error",
      }[outcome],
      outcome[0].toUpperCase() + outcome.slice(1),
    ];
  }
  const [tone, label] = {
    cancelled: ["cancelled", "Cancelled"],
    completed: ["complete", "Completed"],
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
const counts = (value) =>
  value
    ? Object.entries(value)
        .map(([name, count]) => `${name.replaceAll("_", " ")} ${count}`)
        .join(" · ")
    : "Unavailable";
const frozen = (selector, commit) =>
  `${selector.type} ${selector.value} · ${commit}`;
</script>

<template>
  <article class="evaluation-row" :data-evaluation-id="evaluation.id">
    <div class="evaluation-row__summary">
      <FonoIconButton
        class="evaluation-row__toggle"
        icon="list-checks"
        :aria-expanded="expanded"
        :aria-controls="`evaluation-expanded-${evaluation.id}`"
        :label="`${expanded ? 'Collapse' : 'Expand'} evaluation ${evaluation.id}`"
        @click="$emit('toggle')"
      />
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
        <span class="evaluation-row__source-separator">to</span>
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
      <a class="evaluation-row__outcome" :href="evaluationUrl">
        <FonoStatusMark :label="status[0]" :status="status[1]" />
      </a>
      <span class="evaluation-row__duration">{{ duration }}</span>
    </div>
    <FonoTimeline
      class="evaluation-row__timeline"
      aria-label="Step progress"
      :items="
        evaluation.monitor.nodes.map((node) => ({
          id: node.key ?? node.review_version_id,
          label: `${node.kind === 'review' ? 'Review ' : ''}${node.label}: ${nodeStatus(node)[1]}`,
          status: nodeVisualState(node),
        }))
      "
    />
    <div
      v-if="['queued', 'running'].includes(evaluation.execution_status)"
      class="evaluation-actions"
    >
      <FonoButton
        size="compact"
        type="button"
        @click="$emit('mutate', 'cancel')"
      >
        Cancel
      </FonoButton>
      <FonoButton
        v-if="
          evaluation.execution_status === 'queued' &&
          evaluation.retry_state === 'exhausted'
        "
        size="compact"
        type="button"
        @click="$emit('mutate', 'retry')"
      >
        Retry
      </FonoButton>
    </div>
    <FonoButton
      class="evaluation-row__detail"
      :href="evaluationUrl"
      size="compact"
      :aria-label="`Open evaluation ${evaluation.id}`"
      >Open</FonoButton
    >
    <section
      v-if="expanded"
      :id="`evaluation-expanded-${evaluation.id}`"
      class="evaluation-expanded"
    >
      <dl>
        <dt>Evaluation</dt>
        <dd>{{ evaluation.id }}</dd>
        <dt>Base</dt>
        <dd>{{ frozen(evaluation.base_selector, evaluation.base_commit) }}</dd>
        <dt>Head</dt>
        <dd>{{ frozen(evaluation.head_selector, evaluation.head_commit) }}</dd>
        <dt>Created</dt>
        <dd>{{ evaluation.created_at }}</dd>
        <dt>Completed</dt>
        <dd>{{ evaluation.completed_at ?? "In progress" }}</dd>
        <dt>Review statuses</dt>
        <dd>{{ counts(evaluation.monitor.review_counts) }}</dd>
        <dt>Review outcomes</dt>
        <dd>{{ counts(evaluation.monitor.outcome_counts) }}</dd>
        <dt>Findings</dt>
        <dd>{{ counts(evaluation.monitor.finding_counts) }}</dd>
      </dl>
      <ol class="evaluation-expanded__table">
        <li
          v-for="(node, index) in evaluation.monitor.nodes"
          :key="node.key ?? node.review_version_id"
          class="evaluation-node"
        >
          <span class="evaluation-step">
            <span class="evaluation-step__number">{{ index + 1 }}</span
            ><span>{{ node.label }}</span>
          </span>
          <FonoStatusMark
            class="evaluation-node-status"
            :label="nodeStatus(node)[1]"
            :status="nodeStatus(node)[0]"
          />
        </li>
      </ol>
      <a :href="evaluationUrl">Open Evaluation detail</a>
    </section>
  </article>
</template>
