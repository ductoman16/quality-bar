<script setup>
const props = defineProps({ delivery: Object, polling: Object });
const present = (value, absent) => value ?? absent;
const problem = (value) => (value ? `${value.code}: ${value.detail}` : "none");
const connectionHref = (value) =>
  `/?view=repositories&connection_id=${encodeURIComponent(value.connection_id)}#${value.provider}-connection-details`;
const repositoryHref = (id) =>
  `/?view=repository-detail&repository_id=${encodeURIComponent(id)}`;
const evaluationHref = (id) =>
  `/?view=evaluation-detail&evaluation_id=${encodeURIComponent(id)}`;
const nextPollingAttempt = (value) =>
  value.next_attempt_at ??
  (value.next_attempt_after_correction || value.error || value.health_error
    ? "after correction"
    : value.lifecycle === "enabled"
      ? "now"
      : "after lifecycle change");
const providerIdentity = (connection) =>
  connection.provider === "github"
    ? `App ${connection.external_identity.app_slug} (external ${connection.external_identity.app_id}), installation ${connection.external_identity.installation_id}`
    : `Base URL ${connection.external_identity.base_url}, version ${connection.external_identity.reported_version}`;
</script>

<template>
  <section class="qb-region">
    <h2>Polling</h2>
    <ol>
      <li
        v-for="connection in polling.connections"
        :key="connection.connection_id"
      >
        {{ connection.provider }}
        <a :href="connectionHref(connection)"
          >Connection {{ connection.connection_id }}</a
        >. Lifecycle {{ connection.lifecycle }}. Health {{ connection.health }}.
        Health error {{ problem(connection.health_error) }}. Principal
        {{ connection.external_identity.principal_login }} (external
        {{ connection.external_identity.principal_id }}).
        {{ providerIdentity(connection) }}. Next permitted attempt
        {{ nextPollingAttempt(connection) }}. Rate gate
        {{ present(connection.rate_gate_until, "none") }}. Error
        {{ problem(connection.error) }}.
        <span
          v-for="repository in connection.repositories"
          :key="repository.repository_id"
        >
          <a :href="repositoryHref(repository.repository_id)"
            >Repository {{ repository.repository_id }}</a
          >
          ({{ repository.name }}, external
          {{ repository.forge_repository_id }}). Lifecycle
          {{ repository.lifecycle }}. Health {{ repository.health }}. Health
          error {{ problem(repository.health_error) }}. Baseline
          {{ repository.baseline_status }}. Last success
          {{ present(repository.last_success_at, "none") }}. Next permitted
          attempt {{ nextPollingAttempt(repository) }}. Rate gate
          {{ present(repository.rate_gate_until, "none") }}. Error
          {{ problem(repository.error) }}.
        </span>
      </li>
    </ol>
  </section>
  <section class="qb-region">
    <h2>Delivery</h2>
    <ol>
      <li
        v-for="surface in delivery.surfaces"
        :key="`${surface.surface}:${surface.evaluation_id}`"
      >
        <a
          v-if="surface.owner_kind === 'decision'"
          :href="`/api/v1/waiver-decisions/${encodeURIComponent(surface.decision_id)}`"
          >Decision {{ surface.decision_id }}</a
        >
        <span v-if="surface.owner_kind !== 'evaluation'"
          >;
          <a
            :href="`${evaluationHref(surface.evaluation_id)}#waiver-adjudication-${encodeURIComponent(surface.adjudication_id)}`"
            >Adjudication {{ surface.adjudication_id }}</a
          >;
        </span>
        <a :href="evaluationHref(surface.evaluation_id)"
          >Evaluation {{ surface.evaluation_id }}</a
        >. Repository
        <a :href="repositoryHref(surface.repository_id)">{{
          surface.repository_id
        }}</a
        >. Connection
        <a :href="connectionHref(surface)">{{ surface.connection_id }}</a
        >. Surface {{ surface.surface }}. Status {{ surface.status }};
        publication {{ surface.publication_status }}. Attempts
        {{ surface.attempt_count }}. Last attempt
        {{ present(surface.last_attempt_at, "none") }}. Published
        {{ present(surface.published_at, "none") }}. Next permitted attempt
        {{
          surface.next_attempt_at ??
          (["waiting", "reconciling"].includes(surface.status)
            ? "now"
            : "none")
        }}. Reconciliation
        {{ surface.reconciliation_required ? "required" : "not required" }}.
        External identity {{ present(surface.external_id, "none") }}. Provider
        gate {{ present(surface.provider_gate_until, "none") }} ({{
          problem(surface.provider_gate_error)
        }}). Error {{ problem(surface.error) }}. Source
        {{ surface.source_identity }}.
      </li>
    </ol>
  </section>
</template>
