<script setup>
import { computed, onMounted, reactive, ref } from "vue";

import { csrfToken, responseMessage } from "../browser.js";
import { useAlertFocus } from "../useAlertFocus.js";
import {
  validConfiguration,
  validConfigurationChange,
  validSystem,
} from "./contract.js";
import SystemPollingDelivery from "./SystemPollingDelivery.vue";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const system = ref();
const error = ref("");
const errorElement = useAlertFocus(error);
const configuration = reactive({
  model: "",
  reasoning_effort: "",
  service_tier: "",
});
const configurationStatus = ref("Loading");
const selectedModel = computed(() =>
  system.value?.codex?.catalog?.models?.find(
    ({ id }) => id === configuration.model,
  ),
);
const health = computed(() => {
  if (!system.value) return [];
  const value = system.value;
  const providersOk =
    value.execution_providers?.length &&
    value.execution_providers.every(({ status }) => status === "available");
  return [
    [
      "Codex provider",
      providersOk ? "Available" : "Unavailable",
      providersOk ? "ok" : "warn",
    ],
    [
      "Durable core",
      value.durable_core?.status,
      value.durable_core?.status === "ready" ? "ok" : "warn",
    ],
    [
      "Storage",
      value.storage?.status,
      value.storage?.status === "available" ? "ok" : "warn",
    ],
    [
      "Backups",
      value.backup?.status,
      ["current", "empty"].includes(value.backup?.status)
        ? value.backup?.status === "empty"
          ? "idle"
          : "ok"
        : "warn",
    ],
    [
      "Bootstrap",
      value.bootstrap?.status,
      value.bootstrap?.status === "complete" ? "ok" : "warn",
    ],
  ];
});
const attention = computed(
  () => health.value.filter(([, , state]) => state === "warn").length,
);
const humanize = (value) => String(value ?? "Unknown").replaceAll("_", " ");
const resource = (row) =>
  row.evaluation_id
    ? `Evaluation ${row.evaluation_id}${row.review_run_id ? `; Review Run ${row.review_run_id}` : ""}`
    : `Waiver Adjudication ${row.waiver_adjudication_id}`;
const execution = (row) =>
  `${resource(row)}. State ${row.execution_status}. Gate ${row.gate?.code}. Attempts ${row.pre_start_attempt_count} in cycle ${row.retry_cycle}. Retry ${row.retry_state}. Lease ${row.lease?.status}; worker ${row.lease?.worker_id ?? "none"}.`;
const failure = (row) =>
  `${resource(row)}. Failed ${row.completed_at}. Failure ${row.error?.code}: ${row.error?.detail}`;
const factEntries = (value) =>
  Object.entries(value || {}).map(([name, item]) => [
    humanize(name),
    typeof item === "object" ? JSON.stringify(item) : item,
  ]);
async function loadConfiguration() {
  const response = await fetch("/api/v1/waiver-adjudicator-configuration");
  if (!response.ok) {
    configurationStatus.value = await responseMessage(
      response,
      "Configuration failed to load",
    );
    return;
  }
  const body = await response.json();
  if (!validConfiguration(body)) {
    throw new Error("waiver_configuration_invalid");
  }
  if (body.configured) Object.assign(configuration, body.configuration);
  configurationStatus.value = body.configured ? "Configured" : "Not configured";
}
async function load() {
  try {
    const response = await fetch("/api/v1/system");
    if (!response.ok)
      throw new Error(await responseMessage(response, "System failed to load"));
    const value = await response.json();
    if (!validSystem(value)) throw new Error("system_document_invalid");
    system.value = value;
    await loadConfiguration();
  } catch (failure) {
    error.value =
      failure instanceof Error ? failure.message : "System failed to load";
  }
}
async function saveConfiguration() {
  configurationStatus.value = "Saving";
  try {
    const response = await fetch("/api/v1/waiver-adjudicator-configuration", {
      body: JSON.stringify(configuration),
      headers: {
        "content-type": "application/json",
        "x-quality-bar-csrf": csrfToken(props.csrfCookieName),
      },
      method: "PATCH",
    });
    if (!response.ok) {
      error.value = await responseMessage(
        response,
        "Configuration failed to save",
      );
      configurationStatus.value = "Failed";
      return;
    }
    const body = await response.json();
    if (!validConfigurationChange(body))
      throw new Error("Configuration response is invalid");
    Object.assign(configuration, body.configuration);
    configurationStatus.value = body.changed ? "Saved" : "Unchanged";
  } catch (failure) {
    error.value =
      failure instanceof Error
        ? failure.message
        : "Configuration failed to save";
    configurationStatus.value = "Failed";
  }
}
onMounted(load);
</script>

<template>
  <template v-if="system">
    <section class="qb-region sys-zone"><h2>Health</h2></section>
    <section
      class="qb-region sys-summary"
      aria-live="polite"
      :data-state="attention ? 'warn' : 'ok'"
    >
      <p>
        {{
          attention
            ? `${attention} need${attention === 1 ? "s" : ""} attention`
            : "All clear"
        }}
      </p>
    </section>
    <section class="qb-region sys-overview">
      <div class="sys-health">
        <div
          v-for="[label, value, state] in health"
          :key="label"
          class="sys-health__tile"
          :data-state="state"
        >
          <span>{{ label }}</span
          ><strong>{{ humanize(value) }}</strong>
        </div>
      </div>
    </section>
    <section class="qb-region">
      <h2>Execution providers</h2>
      <dl>
        <template
          v-for="provider in system.execution_providers"
          :key="provider.id"
          ><dt>{{ provider.name }}</dt>
          <dd>
            {{ provider.status
            }}<span v-if="provider.error">
              · {{ provider.error.code }}: {{ provider.error.message }} ·
              {{ provider.error.recovery }}</span
            >
          </dd></template
        >
      </dl>
    </section>
    <section class="qb-region">
      <h2>Codex execution</h2>
      <dl>
        <dt>Maximum running</dt>
        <dd>{{ system.codex_execution.concurrency.maximum_running }}</dd>
        <dt>Running</dt>
        <dd>{{ system.codex_execution.concurrency.running_count }}</dd>
        <dt>Start gate</dt>
        <dd>{{ system.codex_execution.concurrency.start_gate }}</dd>
      </dl>
      <div class="sys-lists">
        <div>
          <h3>Queued</h3>
          <ol>
            <li
              v-for="row in system.codex_execution.queue.rows"
              :key="resource(row)"
            >
              {{ execution(row) }}
            </li>
          </ol>
        </div>
        <div>
          <h3>Running</h3>
          <ol>
            <li
              v-for="row in system.codex_execution.running.rows"
              :key="resource(row)"
            >
              {{ execution(row) }}
            </li>
          </ol>
        </div>
        <div>
          <h3>Failures</h3>
          <ol>
            <li
              v-for="row in system.codex_execution.failures"
              :key="resource(row)"
            >
              {{ failure(row) }}
            </li>
          </ol>
        </div>
      </div>
    </section>
    <section class="qb-region">
      <h2>Storage and backup</h2>
      <dl>
        <template
          v-for="[name, value] in [
            ...factEntries(system.storage),
            ...factEntries(system.cleanup),
            ...factEntries(system.backup),
          ]"
          :key="name"
          ><dt>{{ name }}</dt>
          <dd>{{ value }}</dd></template
        >
      </dl>
    </section>
    <SystemPollingDelivery
      :delivery="system.delivery"
      :polling="system.polling"
    />
    <section class="qb-region sys-zone sys-zone--admin">
      <h2>Administration</h2>
    </section>
    <section class="qb-region">
      <h2>Provider &amp; access</h2>
      <dl>
        <dt>Codex models</dt>
        <dd>
          <ul>
            <li v-for="model in system.codex.catalog.models" :key="model.id">
              {{ model.id }} ({{ model.reasoning_efforts.join(", ") }};
              {{ model.service_tiers.join(", ") }})
            </li>
          </ul>
        </dd>
        <dt>Browser sessions</dt>
        <dd>{{ system.browser_sessions.active_count }}</dd>
        <dt>Implementer token</dt>
        <dd>{{ system.implementer_token.status }}</dd>
      </dl>
    </section>
    <section class="qb-region">
      <h2>Storage reserve</h2>
      <dl>
        <template
          v-for="[name, value] in factEntries(system.storage_reserve)"
          :key="name"
          ><dt>{{ name }}</dt>
          <dd>{{ value }}</dd></template
        >
      </dl>
    </section>
    <section class="qb-region qb-deep-surface">
      <h2>Waiver Adjudicator Configuration</h2>
      <form @submit.prevent="saveConfiguration">
        <label for="waiver-model">Model</label
        ><select id="waiver-model" v-model="configuration.model" required>
          <option value=""></option>
          <option
            v-for="model in system.codex.catalog.models"
            :key="model.id"
            :value="model.id"
          >
            {{ model.id }}
          </option></select
        ><label for="waiver-reasoning">Reasoning effort</label
        ><select
          id="waiver-reasoning"
          v-model="configuration.reasoning_effort"
          required
        >
          <option
            v-for="value in selectedModel?.reasoning_efforts"
            :key="value"
          >
            {{ value }}
          </option></select
        ><label for="waiver-tier">Service tier</label
        ><select id="waiver-tier" v-model="configuration.service_tier" required>
          <option v-for="value in selectedModel?.service_tiers" :key="value">
            {{ value }}
          </option></select
        ><button type="submit">Save configuration</button
        ><output aria-live="polite">{{ configurationStatus }}</output>
      </form>
    </section>
  </template>
  <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
    {{ error }}
  </p>
</template>
