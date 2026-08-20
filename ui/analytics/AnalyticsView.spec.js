import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import AnalyticsView from "./AnalyticsView.vue";

const ratio = (numerator = 0, denominator = 0) => ({
  denominator,
  numerator,
});
const duration = () => ({
  execution_count: 0,
  median_ms: null,
  total_ms: null,
});
const counter = () => ({ coverage: ratio(), median: null, sum: null });
const reliability = (outcomes) => ({
  active: 0,
  duration: Object.fromEntries(
    ["terminal", ...outcomes].map((outcome) => [outcome, duration()]),
  ),
  failure_codes: [{ code: "provider_failed", count: 1 }],
  token_counters: {
    cached_input_tokens: counter(),
    input_tokens: counter(),
    output_tokens: counter(),
  },
  ...Object.fromEntries(
    outcomes.flatMap((outcome) => [
      [outcome, 0],
      [`${outcome}_rate`, ratio()],
    ]),
  ),
});
const document_ = {
  criterion_outcomes: [
    {
      clear: 0,
      clear_rate: ratio(),
      criterion_id: "criterion-1",
      error: 0,
      error_rate: ratio(),
      not_applicable: 0,
      not_applicable_rate: ratio(),
      trigger_rate: ratio(),
      triggered: 0,
    },
  ],
  daily_trend: [
    {
      advisory: 0,
      blocking: 0,
      clear: 1,
      date: "2026-08-20",
      error: 0,
      evaluations: 1,
      pending: 0,
    },
    {
      advisory: 0,
      blocking: 0,
      clear: 4,
      date: "2026-08-21",
      error: 0,
      evaluations: 4,
      pending: 0,
    },
  ],
  evaluation_outcomes: {
    advisory: 0,
    advisory_rate: ratio(),
    blocking: 0,
    blocking_rate: ratio(),
    clear: 1,
    clear_rate: ratio(1, 1),
    error: 0,
    error_rate: ratio(),
    pending: 0,
  },
  finding_impact: {
    advisory: 0,
    blocking: 0,
    findings_per_triggered_criterion_result: ratio(),
  },
  population: {
    matching_evaluations: 1,
    matching_waiver_adjudications: 2,
    matching_waiver_decisions: 0,
    matching_waiver_requests: 0,
    pending_adjudications: 0,
    pending_evaluations: 0,
    state: "ready",
    total_evaluations: 1,
  },
  pull_request_criterion_transitions: {
    no_longer_applicable: 0,
    sample_size: 0,
    triggered_to_clear: 0,
    triggered_to_error: 0,
  },
  review_applicability: [
    {
      applicable: 1,
      applicable_rate: ratio(1, 1),
      error: 0,
      error_rate: ratio(),
      not_applicable: 0,
      review_id: "review-1",
    },
  ],
  review_run_reliability: reliability([
    "successful",
    "failed",
    "operator_cancelled",
    "superseded",
  ]),
  waiver_adjudication_reliability: reliability([
    "completed",
    "failed",
    "cancelled",
  ]),
  waiver_analytics: {
    advisory_findings: 0,
    decision_history: {
      accepted: 0,
      accepted_rate: ratio(),
      denied: 0,
      denied_rate: ratio(),
      error: 0,
      error_rate: ratio(),
    },
    requested_findings: 0,
    waived_finding_rate: ratio(),
    waived_findings: 0,
    waiver_request_rate: ratio(),
  },
};

beforeEach(() => {
  history.replaceState(null, "", "/?view=analytics&repository_id=repository-1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => document_, ok: true })),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("renders every Analytics section and restores URL filters on navigation", async () => {
  const wrapper = mount(AnalyticsView);
  await flushPromises();
  for (const title of [
    "Decision history",
    "Pull-request Criterion transitions",
    "Execution failure codes",
    "Execution duration",
    "Token counters",
  ]) {
    expect(wrapper.text()).toContain(title);
  }
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/analytics?repository_id=repository-1",
  );
  expect(
    wrapper
      .findAll(".an-trend__seg--clear")
      .map((item) => item.attributes("style")),
  ).toEqual(["height: 25%;", "height: 100%;"]);
  expect(wrapper.text()).toContain("2 Waiver Adjudications");
  expect(wrapper.get(".an-trend__col").attributes("title")).toContain(
    "0 advisory/blocking/error",
  );

  await wrapper.get("#analytics-model").setValue("gpt-test");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(location.search).toContain("model=gpt-test");

  history.replaceState(null, "", "/?view=analytics&model=gpt-back");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await flushPromises();
  expect(wrapper.get("#analytics-model").element.value).toBe("gpt-back");
  expect(fetch).toHaveBeenLastCalledWith("/api/v1/analytics?model=gpt-back");
  wrapper.unmount();
});
