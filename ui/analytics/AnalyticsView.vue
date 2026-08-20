<script setup>
import { computed, onMounted, reactive, ref } from "vue";

import { responseMessage } from "../browser.js";
import { useAlertFocus } from "../useAlertFocus.js";
import MetricTable from "./MetricTable.vue";

const document_ = ref();
const error = ref("");
const errorElement = useAlertFocus(error);
const filters = reactive({
  repository_id: "",
  base_commit: "",
  head_commit: "",
  pull_request_number: "",
  review_id: "",
  review_version_id: "",
  criterion_id: "",
  model: "",
  reasoning_effort: "",
  service_tier: "",
  terminal_outcome: "",
  start: "",
  end: "",
});
const rate = (value) =>
  value?.denominator ? `${value.numerator}/${value.denominator}` : "—";
const percent = (value) =>
  value?.denominator
    ? `${Math.round((value.numerator / value.denominator) * 100)}%`
    : "—";
const valid = (value) =>
  value &&
  Array.isArray(value.review_applicability) &&
  Array.isArray(value.criterion_outcomes) &&
  Array.isArray(value.daily_trend) &&
  typeof value.population === "object" &&
  typeof value.evaluation_outcomes === "object" &&
  typeof value.review_run_reliability === "object" &&
  typeof value.waiver_adjudication_reliability === "object";
const overview = computed(() => {
  const value = document_.value;
  if (!value) return [];
  const counters = value.review_run_reliability.token_counters;
  const tokens =
    counters.input_tokens.sum === null || counters.output_tokens.sum === null
      ? null
      : counters.input_tokens.sum + counters.output_tokens.sum;
  const per = (count) =>
    tokens === null || !count ? "—" : Math.round(tokens / count);
  return [
    ["Evaluations", value.population.matching_evaluations],
    ["Clear", percent(value.evaluation_outcomes.clear_rate)],
    ["Blocking", percent(value.evaluation_outcomes.blocking_rate)],
    ["Errors", percent(value.evaluation_outcomes.error_rate)],
    ["Review success", percent(value.review_run_reliability.successful_rate)],
    ["Tokens / Evaluation", per(value.population.matching_evaluations)],
    ["Tokens / Blocking Finding", per(value.finding_impact.blocking)],
  ];
});
const tables = computed(() => {
  const value = document_.value;
  if (!value) return [];
  const outcomes = value.evaluation_outcomes;
  const waivers = value.waiver_analytics;
  const runs = value.review_run_reliability;
  const adjudications = value.waiver_adjudication_reliability;
  return [
    {
      title: "Evaluation outcomes",
      headers: [
        "Clear",
        "Advisory",
        "Blocking",
        "Error",
        "Pending",
        "Clear share",
        "Advisory share",
        "Blocking share",
        "Error share",
      ],
      rows: [
        [
          outcomes.clear,
          outcomes.advisory,
          outcomes.blocking,
          outcomes.error,
          outcomes.pending,
          rate(outcomes.clear_rate),
          rate(outcomes.advisory_rate),
          rate(outcomes.blocking_rate),
          rate(outcomes.error_rate),
        ],
      ],
    },
    {
      title: "Finding impact",
      headers: [
        "Advisory Findings",
        "Blocking Findings",
        "Findings / triggered Criterion",
      ],
      rows: [
        [
          value.finding_impact.advisory,
          value.finding_impact.blocking,
          rate(value.finding_impact.findings_per_triggered_criterion_result),
        ],
      ],
    },
    {
      title: "Review applicability",
      headers: [
        "Review",
        "Applicable",
        "Not applicable",
        "Errors",
        "Applicability rate",
        "Error rate",
      ],
      rows: value.review_applicability.map((item) => [
        item.review_id,
        item.applicable,
        item.not_applicable,
        item.error,
        rate(item.applicability_rate),
        rate(item.error_rate),
      ]),
    },
    {
      title: "Criterion outcomes",
      headers: [
        "Criterion",
        "Triggered",
        "Clear",
        "Not applicable",
        "Error",
        "Trigger rate",
        "Clear rate",
        "Not applicable rate",
        "Error rate",
      ],
      rows: value.criterion_outcomes.map((item) => [
        item.criterion_id,
        item.triggered,
        item.clear,
        item.not_applicable,
        item.error,
        rate(item.trigger_rate),
        rate(item.clear_rate),
        rate(item.not_applicable_rate),
        rate(item.error_rate),
      ]),
    },
    {
      title: "Waiver coverage",
      headers: [
        "Advisory Findings",
        "Requested Findings",
        "Request rate",
        "Waived Findings",
        "Waived rate",
      ],
      rows: [
        [
          waivers.advisory_findings,
          waivers.requested_findings,
          rate(waivers.waiver_request_rate),
          waivers.waived_findings,
          rate(waivers.waived_finding_rate),
        ],
      ],
    },
    {
      title: "Review-Run reliability",
      headers: [
        "Successful",
        "Failed",
        "Operator-cancelled",
        "Superseded",
        "Active",
        "Success share",
        "Failed share",
        "Cancelled share",
        "Superseded share",
      ],
      rows: [
        [
          runs.successful,
          runs.failed,
          runs.operator_cancelled,
          runs.superseded,
          runs.active,
          rate(runs.successful_rate),
          rate(runs.failed_rate),
          rate(runs.operator_cancelled_rate),
          rate(runs.superseded_rate),
        ],
      ],
    },
    {
      title: "Waiver-Adjudication reliability",
      headers: [
        "Completed",
        "Failed",
        "Cancelled",
        "Active",
        "Completed share",
        "Failed share",
        "Cancelled share",
      ],
      rows: [
        [
          adjudications.completed,
          adjudications.failed,
          adjudications.cancelled,
          adjudications.active,
          rate(adjudications.completed_rate),
          rate(adjudications.failed_rate),
          rate(adjudications.cancelled_rate),
        ],
      ],
    },
  ];
});
async function load(updateUrl = false) {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(
    ([name, value]) => value && search.set(name, value),
  );
  if (updateUrl)
    history.pushState(
      null,
      "",
      `/?view=analytics${search.size ? `&${search}` : ""}`,
    );
  try {
    const response = await fetch(
      `/api/v1/analytics${search.size ? `?${search}` : ""}`,
    );
    if (!response.ok)
      throw new Error(
        await responseMessage(response, "Analytics failed to load"),
      );
    const value = await response.json();
    if (!valid(value)) throw new Error("analytics_document_invalid");
    document_.value = value;
    error.value = "";
  } catch (failure) {
    document_.value = null;
    error.value =
      failure instanceof Error ? failure.message : "Analytics failed to load";
  }
}
function fromLocation() {
  const search = new URLSearchParams(location.search);
  Object.keys(filters).forEach(
    (name) => (filters[name] = search.get(name) ?? ""),
  );
}
onMounted(() => {
  fromLocation();
  window.addEventListener("popstate", () => {
    fromLocation();
    void load();
  });
  void load();
});
</script>

<template>
  <section v-if="document_" class="qb-region an-overview">
    <div class="an-stat-strip">
      <div v-for="[label, value] in overview" :key="label" class="an-stat">
        <span>{{ label }}</span
        ><output>{{ value }}</output>
      </div>
    </div>
    <p>
      {{ document_.population.state.replaceAll("_", " ") }} ·
      {{ document_.population.matching_evaluations }}/{{
        document_.population.total_evaluations
      }}
      Evaluations · {{ document_.population.matching_waiver_requests }} Waiver
      Requests · {{ document_.population.matching_waiver_decisions }} Waiver
      Decisions
    </p>
    <div class="an-trend" aria-label="Daily Evaluation trend">
      <div
        v-for="bucket in document_.daily_trend"
        :key="bucket.date"
        class="an-trend__col"
        :title="`${bucket.date}: ${bucket.evaluations} evaluations`"
      >
        <span
          class="an-trend__seg an-trend__seg--clear"
          :style="{
            height: `${bucket.evaluations ? (bucket.clear / bucket.evaluations) * 100 : 0}%`,
          }"
        ></span
        ><span
          class="an-trend__seg an-trend__seg--problem"
          :style="{
            height: `${bucket.evaluations ? ((bucket.advisory + bucket.blocking + bucket.error) / bucket.evaluations) * 100 : 0}%`,
          }"
        ></span>
      </div>
    </div>
  </section>
  <details class="an-filters">
    <summary>Filters</summary>
    <form class="analytics-filters" @submit.prevent="load(true)">
      <template v-for="name in Object.keys(filters)" :key="name"
        ><label :for="`analytics-${name}`">{{
          name.replaceAll("_", " ")
        }}</label
        ><select
          v-if="name === 'terminal_outcome'"
          :id="`analytics-${name}`"
          v-model="filters[name]"
        >
          <option value="">All</option>
          <option
            v-for="value in ['clear', 'advisory', 'blocking', 'error']"
            :key="value"
          >
            {{ value }}
          </option></select
        ><input
          v-else
          :id="`analytics-${name}`"
          v-model="filters[name]"
          :type="
            ['start', 'end', 'pull_request_number'].includes(name)
              ? 'number'
              : 'text'
          " /></template
      ><button type="submit">Filter</button>
    </form>
  </details>
  <section v-for="table in tables" :key="table.title" class="qb-region an-band">
    <h2>{{ table.title }}</h2>
    <MetricTable :headers="table.headers" :rows="table.rows" />
  </section>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
    {{ error }}
  </p>
</template>
