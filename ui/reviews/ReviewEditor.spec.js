import { mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import ReviewEditor from "./ReviewEditor.vue";

const models = [
  {
    id: "gpt-test",
    reasoning_efforts: ["high"],
    service_tiers: ["standard"],
  },
];
const snapshot = {
  applicability_rule: null,
  codex_configuration: {
    model: "gpt-test",
    reasoning_effort: "high",
    service_tier: "standard",
  },
  criteria: [
    { id: "criterion-1", impact: "blocking", instruction: "First" },
    { id: "criterion-2", impact: "advisory", instruction: "Second" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

it("confirms retirement, restores focus, and focuses a new Criterion", async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  const wrapper = mount(ReviewEditor, {
    attachTo: document.body,
    props: { models, snapshot },
  });
  await wrapper.findAll('[aria-label^="Retire Criterion"]')[0].trigger("click");
  expect(confirm).toHaveBeenCalledWith(
    "Retire Criterion 1 from the next Review Version?",
  );
  expect(wrapper.findAll("textarea")).toHaveLength(3);

  confirm.mockReturnValue(true);
  await wrapper.findAll('[aria-label^="Retire Criterion"]')[0].trigger("click");
  expect(wrapper.findAll("textarea")).toHaveLength(2);
  expect(document.activeElement).toBe(wrapper.findAll("textarea")[0].element);

  await wrapper.get('[aria-label="Add Criterion"]').trigger("click");
  expect(wrapper.findAll("textarea")).toHaveLength(3);
  expect(document.activeElement).toBe(wrapper.findAll("textarea")[1].element);

  await wrapper.get("form").trigger("submit");
  expect(wrapper.emitted("save")).toHaveLength(1);
  wrapper.unmount();
});
