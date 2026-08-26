import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import ConnectionLifecycleDialog from "./ConnectionLifecycleDialog.vue";

afterEach(() => vi.restoreAllMocks());

it("focuses confirmation, keeps validation inside, and restores the trigger", async () => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  const trigger = document.body.appendChild(document.createElement("button"));
  trigger.focus();
  const wrapper: any = mount(ConnectionLifecycleDialog, {
    attachTo: document.body,
  });
  await wrapper.vm.open("GitHub", "PATCH");
  expect(document.activeElement).toBe(
    wrapper.findAll("button").find((button: any) => button.text() === "Confirm")
      .element,
  );
  await wrapper
    .findAll("button")
    .find((button: any) => button.text() === "Cancel")
    .trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(trigger);

  trigger.focus();
  await wrapper.vm.open("GitHub", "DELETE");
  await wrapper.get("input").setValue("wrong");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("Type DELETE");
  expect(document.activeElement).toBe(wrapper.get("input").element);
  expect(wrapper.emitted("change")).toBeUndefined();
  wrapper.unmount();
  trigger.remove();
});
