<script setup>
import { nextTick, ref } from "vue";

import EvaluationRow from "./EvaluationRow.vue";
import { useEvaluations } from "./useEvaluations.js";
import { useAlertFocus } from "../useAlertFocus.js";

const props = defineProps({ csrfCookieName: { required: true, type: String } });
const state = useEvaluations(props.csrfCookieName);
const errorElement = useAlertFocus(state.error);
const repositorySelect = ref();
const toggleCreate = async () => {
  state.createOpen.value = !state.createOpen.value;
  if (state.createOpen.value) {
    await nextTick();
    repositorySelect.value?.focus();
  }
};
const dayHeading = (evaluation) => {
  const date = new Date(evaluation.created_at);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};
</script>

<template>
  <section
    id="evaluation-monitor"
    class="evaluation-monitor"
    aria-label="Evaluation monitor"
  >
    <section class="qb-stat-strip" aria-label="Fleet statistics">
      <div
        v-for="[label, value] in [
          ['Workers', state.stats.workers],
          ['Queue', state.stats.queue],
          ['P95 Duration', state.stats.p95],
          ['Clear Rate', state.stats.clearRate],
          ['Updated', state.stats.updated],
        ]"
        :key="label"
        class="qb-stat evaluation-stat"
      >
        <span>{{ label }}</span
        ><output>{{ value }}</output>
      </div>
    </section>
    <div class="evaluation-monitor__controls">
      <div class="evaluation-stat-window" aria-label="Statistics window">
        <button
          type="button"
          :aria-pressed="state.statsWindow.value === 24"
          @click="state.refreshStats(24)"
        >
          24h
        </button>
        <button
          type="button"
          :aria-pressed="state.statsWindow.value === 168"
          @click="state.refreshStats(168)"
        >
          7d
        </button>
      </div>
      <button
        :class="`qb-btn ${state.createOpen.value ? 'qb-btn--secondary' : 'qb-btn--primary'}`"
        type="button"
        :aria-expanded="state.createOpen.value"
        aria-controls="evaluation-create-form"
        @click="toggleCreate"
      >
        + New evaluation
      </button>
    </div>
    <form
      v-if="state.createOpen.value"
      id="evaluation-create-form"
      @submit.prevent="state.submitCreate"
    >
      <label for="evaluation-create-repository">Repository</label>
      <select
        id="evaluation-create-repository"
        ref="repositorySelect"
        v-model="state.create.repositoryId"
        :disabled="!state.repositories.value.length"
        required
      >
        <option
          v-for="repository in state.repositories.value"
          :key="repository.id"
          :value="repository.id"
        >
          {{ repository.url }}
        </option>
      </select>
      <label for="evaluation-create-base-type">Base type</label>
      <select id="evaluation-create-base-type" v-model="state.create.baseType">
        <option value="branch">Branch</option>
        <option value="commit">Commit</option>
      </select>
      <label for="evaluation-create-base-value">Base value</label
      ><input
        id="evaluation-create-base-value"
        v-model="state.create.baseValue"
        required
      />
      <label for="evaluation-create-head-type">Head type</label>
      <select id="evaluation-create-head-type" v-model="state.create.headType">
        <option value="branch">Branch</option>
        <option value="commit">Commit</option>
      </select>
      <label for="evaluation-create-head-value">Head value</label
      ><input
        id="evaluation-create-head-value"
        v-model="state.create.headValue"
        required
      />
      <button class="qb-btn qb-btn--primary" type="submit">Evaluate</button
      ><output aria-live="polite">{{ state.createStatus.value }}</output>
    </form>
    <details class="evaluation-filters">
      <summary>Filters</summary>
      <form class="evaluation-filter-form" @submit.prevent="state.applyFilters">
        <label for="evaluation-filter-repository">Repository</label>
        <select
          id="evaluation-filter-repository"
          v-model="state.filters.repository_id"
        >
          <option value="">All repositories</option>
          <option
            v-for="repository in state.repositories.value"
            :key="repository.id"
            :value="repository.id"
          >
            {{ repository.url }}
          </option>
        </select>
        <label for="evaluation-filter-status">Status</label>
        <select
          id="evaluation-filter-status"
          v-model="state.filters.execution_status"
        >
          <option value="">All statuses</option>
          <option
            v-for="status in [
              'queued',
              'running',
              'completed',
              'failed',
              'cancelled',
            ]"
            :key="status"
            :value="status"
          >
            {{ status[0].toUpperCase() + status.slice(1) }}
          </option>
        </select>
        <label for="evaluation-filter-outcome">Outcome</label>
        <select
          id="evaluation-filter-outcome"
          v-model="state.filters.effective_outcome"
        >
          <option value="">All outcomes</option>
          <option
            v-for="outcome in [
              'pending',
              'clear',
              'advisory',
              'blocking',
              'error',
            ]"
            :key="outcome"
            :value="outcome"
          >
            {{ outcome[0].toUpperCase() + outcome.slice(1) }}
          </option>
        </select>
        <label for="evaluation-filter-query">Query</label
        ><input
          id="evaluation-filter-query"
          v-model="state.filters.query"
          maxlength="200"
        />
        <label for="evaluation-filter-start">Start</label
        ><input
          id="evaluation-filter-start"
          v-model="state.filters.start"
          type="datetime-local"
        />
        <label for="evaluation-filter-end">End</label
        ><input
          id="evaluation-filter-end"
          v-model="state.filters.end"
          type="datetime-local"
        />
        <button class="qb-btn qb-btn--secondary" type="submit">Apply</button
        ><button
          class="qb-btn qb-btn--secondary"
          type="button"
          @click="state.resetFilters"
        >
          Reset
        </button>
      </form>
    </details>
    <p v-if="state.loading.value" aria-live="polite">Loading Evaluations</p>
    <p v-else-if="!state.evaluations.value.length">No Evaluations</p>
    <p v-if="state.error.value" ref="errorElement" role="alert" tabindex="-1">
      {{ state.error.value }}
    </p>
    <section class="evaluation-ledger" aria-label="Evaluation ledger">
      <section
        v-for="group in state.groups.value"
        :key="group[0].created_at.slice(0, 10)"
        class="evaluation-date-group"
      >
        <h2 class="evaluation-date-heading">{{ dayHeading(group[0]) }}</h2>
        <EvaluationRow
          v-for="evaluation in group"
          :key="evaluation.id"
          :evaluation="evaluation"
          :repository="state.repositoryById(evaluation.repository.id)"
          :expanded="state.expanded.has(evaluation.id)"
          @toggle="
            state.expanded.has(evaluation.id)
              ? state.expanded.delete(evaluation.id)
              : state.expanded.add(evaluation.id)
          "
          @mutate="state.mutate(evaluation, $event)"
        />
      </section>
    </section>
    <div class="evaluation-list-actions">
      <button
        v-if="state.newActivity.value"
        type="button"
        @click="state.revealActivity"
      >
        New activity available
      </button>
      <button
        v-if="state.nextCursor.value"
        type="button"
        @click="state.refresh({ cursor: state.nextCursor.value })"
      >
        Load more
      </button>
    </div>
  </section>
</template>
