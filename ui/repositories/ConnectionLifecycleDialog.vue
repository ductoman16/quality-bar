<script setup>
import { FonoButton, FonoDialog } from "fono-ui";
import { nextTick, reactive, ref } from "vue";

const emit = defineEmits(["change"]);
const dialogOpen = ref(false);
const input = ref();
const confirmButton = ref();
const error = ref("");
let trigger;
const value = reactive({
  identity: "",
  method: "PATCH",
  provider: "",
  text: "",
});

async function open(provider, method, identity) {
  value.provider = provider;
  value.method = method;
  value.identity = identity;
  value.text = "";
  error.value = "";
  trigger = document.activeElement;
  dialogOpen.value = true;
  await nextTick();
  const target = method === "DELETE" ? input.value : confirmButton.value.$el;
  if (!(target instanceof HTMLElement)) {
    throw new Error("connection_dialog_focus_target_unavailable");
  }
  target.focus();
}
const close = async () => {
  dialogOpen.value = false;
  await nextTick();
  if (!(trigger instanceof HTMLElement)) {
    throw new Error("connection_dialog_trigger_unavailable");
  }
  trigger.focus();
};
async function submit() {
  if (value.method === "DELETE" && value.text !== "DELETE") {
    error.value = `Type DELETE to confirm permanent ${value.provider} Connection deletion`;
    await nextTick();
    input.value.focus();
    return;
  }
  await close();
  emit("change", { method: value.method, provider: value.provider });
}
defineExpose({ open });
</script>

<template>
  <FonoDialog
    :open="dialogOpen"
    aria-labelledby="connection-confirmation-title"
    @update:open="dialogOpen = $event"
  >
    <form @submit.prevent="submit">
      <h3 id="connection-confirmation-title">
        Confirm {{ value.provider }} Connection change
      </h3>
      <p>
        {{
          value.method === "DELETE"
            ? `Delete ${value.provider} Connection for ${value.identity} permanently. This cannot be undone.`
            : `Retire ${value.provider} Connection for ${value.identity}. Its ${value.provider === "Forgejo" ? "PAT" : "credential"} will be destroyed and reactivation requires verification.`
        }}
      </p>
      <label v-if="value.method === 'DELETE'" for="connection-confirmation"
        >Type DELETE to confirm permanent deletion</label
      ><input
        v-if="value.method === 'DELETE'"
        id="connection-confirmation"
        ref="input"
        v-model="value.text"
        required
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <FonoButton type="button" @click="close">Cancel</FonoButton
      ><FonoButton ref="confirmButton" type="submit">Confirm</FonoButton>
    </form>
  </FonoDialog>
</template>
