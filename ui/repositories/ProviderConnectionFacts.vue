<script setup>
import { computed } from "vue";

const props = defineProps({
  connection: { required: true, type: Object },
  provider: { required: true, type: String },
});
const latest = computed(() => props.connection.verification_history.at(-1));
const facts = (value) =>
  Object.entries(value)
    .map(([name, state]) => `${name}: ${state}`)
    .join("; ");
</script>

<template>
  <dl>
    <dt>Identity</dt>
    <dd>{{ connection.principal.login }}</dd>
    <dt>Lifecycle</dt>
    <dd>{{ connection.lifecycle }}</dd>
    <dt>Health</dt>
    <dd>{{ connection.health_error?.message || connection.health }}</dd>
    <dt>API profile</dt>
    <dd>{{ connection.api_profile }}</dd>
    <template v-if="provider === 'Forgejo'">
      <dt>Version</dt>
      <dd>{{ connection.reported_version }}</dd>
    </template>
    <dt>
      {{ provider === "Forgejo" ? "Required authorities" : "Permissions" }}
    </dt>
    <dd>
      {{
        provider === "Forgejo"
          ? connection.scopes.join("; ")
          : facts(connection.permissions)
      }}
    </dd>
    <dt>Capabilities</dt>
    <dd>{{ facts(connection.capabilities) }}</dd>
    <dt>Latest verification</dt>
    <dd>
      {{ latest.trigger }} — {{ latest.outcome }} —
      {{ new Date(latest.verified_at).toLocaleString() }}
    </dd>
  </dl>
  <details>
    <summary>Verification history</summary>
    <pre>{{ JSON.stringify(connection.verification_history, null, 2) }}</pre>
  </details>
  <details>
    <summary>Polling</summary>
    <pre>{{
      JSON.stringify(
        { failure: connection.polling_failure, states: connection.polling },
        null,
        2,
      )
    }}</pre>
  </details>
</template>
