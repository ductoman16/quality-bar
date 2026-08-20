<script setup>
import { computed } from "vue";

const props = defineProps({
  evaluation: { required: true, type: Object },
  result: { required: true, type: Object },
});

const runFor = (criterion) =>
  props.result.review_runs.find((run) => run.id === criterion.review_run_id);
const findingsFor = (criterion) =>
  props.result.findings.filter(
    (finding) =>
      finding.review_run_id === criterion.review_run_id &&
      finding.criterion_id === criterion.criterion_id,
  );
const outcome = (value) =>
  value === "not_applicable" ? "not applicable" : value;
const locationText = (location) => {
  if (location.kind === "changeset") return "Changeset";
  const side = `${location.side} ${location.path}`;
  return location.kind === "line_range"
    ? `${side}:${location.start_line}-${location.end_line}`
    : side;
};
const locationUrl = (finding) => {
  if (finding.location.kind === "changeset") return "";
  const search = new URLSearchParams({
    evaluation_id: props.evaluation.id,
    file_change_id: finding.location.file_change_id,
    side: finding.location.side,
    view: "evaluations",
  });
  if (finding.location.kind === "line_range") {
    search.set("start_line", finding.location.start_line);
    search.set("end_line", finding.location.end_line);
  }
  return `/?${search}`;
};
const focusedFinding = computed(() => {
  const search = new URLSearchParams(location.search);
  return props.result.findings.find((finding) => {
    const point = finding.location;
    return (
      search.get("evaluation_id") === props.evaluation.id &&
      search.get("file_change_id") === point.file_change_id &&
      search.get("side") === point.side &&
      (point.kind !== "line_range" ||
        (search.get("start_line") === String(point.start_line) &&
          search.get("end_line") === String(point.end_line)))
    );
  });
});
const fileChange = (finding) =>
  props.result.file_changes.find(
    (change) => change.id === finding.location.file_change_id,
  );
</script>

<template>
  <section class="evaluation-result">
    <h2>Result {{ result.outcome }}</h2>
    <details
      v-for="applicability in result.applicability_results"
      :key="`${applicability.review_id}:${applicability.review_version_id}`"
    >
      <summary>
        Applicability {{ applicability.review_id }}
        {{ applicability.review_version_id }} —
        {{ outcome(applicability.outcome) }}
      </summary>
      <p>Assignment {{ applicability.assignment.scope }}</p>
      <p v-if="applicability.outcome === 'error'">
        Error {{ applicability.error.code }}: {{ applicability.error.detail }}
      </p>
      <ul v-else-if="applicability.evidence?.kind === 'matched'">
        <template
          v-for="match in applicability.evidence.matches"
          :key="`${match.before_path}:${match.after_path}`"
        >
          <li v-if="match.sides.includes('before') && match.before_path">
            before {{ match.before_path }}
          </li>
          <li v-if="match.sides.includes('after') && match.after_path">
            after {{ match.after_path }}
          </li>
        </template>
      </ul>
    </details>
    <details
      v-for="run in result.review_runs.filter((item) =>
        ['cancelled', 'failed'].includes(item.execution_status),
      )"
      :key="run.id"
    >
      <summary>
        Review {{ run.review_id }} {{ run.review_version_id }} —
        {{ run.execution_status }}
      </summary>
      <p>Error {{ run.error.code }}: {{ run.error.detail }}</p>
    </details>
    <details
      v-for="criterion in result.criterion_results"
      :key="`${criterion.review_run_id}:${criterion.criterion_id}`"
      :open="findingsFor(criterion).includes(focusedFinding)"
    >
      <summary>
        Criterion {{ criterion.criterion_id }} —
        {{ outcome(criterion.outcome) }} — Review
        {{ runFor(criterion)?.review_id }}
        {{ runFor(criterion)?.review_version_id }}
      </summary>
      <p v-if="criterion.outcome === 'error'">
        Error {{ criterion.error.code }}: {{ criterion.error.detail }}
      </p>
      <details
        v-for="finding in findingsFor(criterion)"
        :key="finding.id"
        :open="focusedFinding === finding"
      >
        <summary>Finding {{ finding.id }} — {{ finding.impact }}</summary>
        <p>Evidence: {{ finding.evidence }}</p>
        <p>Remediation: {{ finding.remediation }}</p>
        <a v-if="locationUrl(finding)" :href="locationUrl(finding)">{{
          locationText(finding.location)
        }}</a>
        <span v-else>{{ locationText(finding.location) }}</span>
        <details v-if="focusedFinding === finding && fileChange(finding)" open>
          <summary>Frozen diff — {{ locationText(finding.location) }}</summary>
          <pre>{{ fileChange(finding).patch }}</pre>
        </details>
      </details>
    </details>
  </section>
</template>
