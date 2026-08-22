<script setup>
import { nextTick, reactive, ref } from "vue";

const emit = defineEmits(["change"]);
const dialog = ref();
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
  dialog.value.showModal();
  await nextTick();
  (method === "DELETE" ? input.value : confirmButton.value).focus();
}
async function close() {
  dialog.value.close();
  await nextTick();
  trigger?.focus();
}
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
  <dialog
    ref="dialog"
    aria-labelledby="connection-confirmation-title"
    @cancel.prevent="close"
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
      <button type="button" @click="close">Cancel</button
      ><button ref="confirmButton" type="submit">Confirm</button>
    </form>
  </dialog>
</template>
