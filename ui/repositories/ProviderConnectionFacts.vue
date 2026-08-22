<script setup>
import { computed } from "vue";

const props = defineProps({
  connection: { required: true, type: Object },
  provider: { required: true, type: String },
});
const latest = computed(() => props.connection.verification_history.at(-1));
const facts = (value) =>
  Object.entries(value ?? {})
    .map(([name, state]) => `${name}: ${state}`)
    .join("; ");
const error = (value) =>
  value
    ? `${value.message} (${value.code})${value.repository_id ? `; Repository ${value.repository_id}` : ""}`
    : "No error";
const verification = (value) => {
  const checks = (value.repository_checks ?? value.repositories).map(
    (item) =>
      `${item.full_name ?? item.repository_id ?? item.forge_repository_id ?? item.id}: ${item.outcome ?? "enumerated"}${item.error ? `; ${error(item.error)}` : ""}`,
  );
  return `${value.trigger}; ${value.outcome}; ${new Date(value.verified_at).toLocaleString()}; Principal ${value.principal ? `${value.principal.login} (${value.principal.id})` : "not completed"}; Authorities ${facts(value.permissions) || value.scopes?.join(", ") || "not completed"}; Capabilities ${facts(value.capabilities) || "not completed"}; Repository checks ${checks.join(", ") || "none"}; ${error(value.error)}`;
};
const polling = (value) =>
  `Repository ${value.forge_repository_id}; ${value.baseline_status}; last success ${value.last_success_at ? new Date(value.last_success_at).toLocaleString() : "none"}; next attempt ${value.next_attempt_at ? new Date(value.next_attempt_at).toLocaleString() : "after correction"}; rate gate ${value.rate_gate_until ? new Date(value.rate_gate_until).toLocaleString() : "none"}; ${error(value.error)}`;
const pollingFailure = (value) =>
  `Repository ${value.forge_repository_id ?? "connection"}; next attempt ${value.next_attempt_at ? new Date(value.next_attempt_at).toLocaleString() : "after correction"}; rate gate ${value.rate_gate_until ? new Date(value.rate_gate_until).toLocaleString() : "none"}; ${error(value.error)}`;
</script>

<template>
  <dl>
    <dt>Identity</dt>
    <dd>{{ connection.principal.login }}</dd>
    <dt>Lifecycle</dt>
    <dd>{{ connection.lifecycle }}</dd>
    <dt>Health</dt>
    <dd>
      {{
        connection.health_error
          ? error(connection.health_error)
          : connection.health
      }}
    </dd>
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
    <ol>
      <li v-for="item in connection.verification_history" :key="item.id">
        {{ verification(item) }}
      </li>
    </ol>
  </details>
  <details>
    <summary>Polling</summary>
    <ol>
      <li v-if="connection.polling_failure">
        {{ pollingFailure(connection.polling_failure) }}
      </li>
      <li v-for="item in connection.polling" :key="item.forge_repository_id">
        {{ polling(item) }}
      </li>
    </ol>
  </details>
</template>
