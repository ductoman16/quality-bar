<script setup>
import { FonoButton } from "fono-ui";
defineProps({
  connection: { required: true, type: Object },
  provider: { required: true, type: String },
  used: { default: false, type: Boolean },
});
const emit = defineEmits(["open"]);
</script>
<template>
  <FonoButton
    v-if="connection.lifecycle !== 'retired' && (provider === 'GitHub' || used)"
    type="button"
    @click="emit('open', provider, 'PATCH', connection.principal.login)"
  >
    Retire {{ provider }} Connection</FonoButton
  ><FonoButton
    v-if="provider === 'GitHub' || !used"
    type="button"
    @click="emit('open', provider, 'DELETE', connection.principal.login)"
  >
    Delete {{ provider }} Connection
  </FonoButton>
</template>
