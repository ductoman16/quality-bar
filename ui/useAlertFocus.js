import { nextTick, ref, watch } from "vue";

export function useAlertFocus(message) {
  const element = ref();
  watch(message, async (value) => {
    if (value) {
      await nextTick();
      element.value?.focus();
    }
  });
  return element;
}
