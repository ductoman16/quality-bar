<script setup>
import { nextTick, reactive, ref } from "vue";

const emit = defineEmits(["change", "error"]);
const dialog = ref();
const input = ref();
const value = reactive({ method: "PATCH", provider: "", text: "" });

async function open(provider, method) {
  value.provider = provider;
  value.method = method;
  value.text = "";
  dialog.value.showModal();
  if (method === "DELETE") {
    await nextTick();
    input.value.focus();
  }
}
function submit() {
  if (value.method === "DELETE" && value.text !== "DELETE") {
    emit(
      "error",
      `Type DELETE to confirm permanent ${value.provider} Connection deletion`,
    );
    input.value.focus();
    return;
  }
  dialog.value.close();
  emit("change", { method: value.method, provider: value.provider });
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" aria-labelledby="connection-confirmation-title">
    <form @submit.prevent="submit">
      <h3 id="connection-confirmation-title">
        Confirm {{ value.provider }} Connection change
      </h3>
      <p>
        {{
          value.method === "DELETE"
            ? "This cannot be undone."
            : "Its credential will be destroyed and reactivation requires verification."
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
      /><button type="button" @click="dialog.close()">Cancel</button
      ><button type="submit">Confirm</button>
    </form>
  </dialog>
</template>
