<script setup>
import { onMounted, ref } from "vue";

defineProps({
  action: { required: true, type: String },
  manifest: { required: true, type: Object },
});
const form = ref();
onMounted(() => form.value.submit());
</script>

<template>
  <form ref="form" :action="action" method="POST">
    <input name="manifest" type="hidden" :value="JSON.stringify(manifest)" />
  </form>
</template>
