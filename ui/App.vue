<script setup>
import { computed, onMounted, ref } from "vue";

import AnalyticsView from "./analytics/AnalyticsView.vue";
import { requireStatus } from "./browser.ts";
import EvaluationDetailView from "./evaluations/EvaluationDetailView.vue";
import EvaluationsView from "./evaluations/EvaluationsView.vue";
import LoginView from "./LoginView.vue";
import OperatorControls from "./OperatorControls.vue";
import RepositoriesView from "./repositories/RepositoriesView.vue";
import RepositoryDetailView from "./repositories/RepositoryDetailView.vue";
import ReviewDetailView from "./reviews/ReviewDetailView.vue";
import ReviewsView from "./reviews/ReviewsView.vue";
import SystemView from "./system/SystemView.vue";
import { validSystem } from "./system/contract.ts";
import { useAlertFocus } from "./useAlertFocus.ts";

const props = defineProps({
  authenticated: { required: true, type: Boolean },
  csrfCookieName: String,
  intendedDestination: String,
  view: { required: true, type: String },
});
const attention = ref(0);
const attentionError = ref("");
const attentionErrorElement = useAlertFocus(attentionError);
const theme = ref("");
const component = computed(
  () =>
    ({
      analytics: AnalyticsView,
      "evaluation-detail": EvaluationDetailView,
      evaluations: EvaluationsView,
      repositories: RepositoriesView,
      "repository-detail": RepositoryDetailView,
      reviews: ReviewsView,
      "review-detail": ReviewDetailView,
      system: SystemView,
    })[props.view],
);
const active = (name) =>
  props.view === name ||
  (name === "evaluations" && props.view === "evaluation-detail") ||
  (name === "reviews" && props.view === "review-detail") ||
  (name === "repositories" && props.view === "repository-detail");
const heading = computed(
  () =>
    ({
      "evaluation-detail": "Evaluation",
      "repository-detail": "Repository",
      "review-detail": "Review",
    })[props.view] ?? props.view[0].toUpperCase() + props.view.slice(1),
);
const toggleTheme = () => {
  const root = document.documentElement;
  const current =
    root.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  theme.value = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", theme.value);
  document.cookie = `qb_theme=${theme.value};path=/;max-age=31536000;samesite=lax`;
};
onMounted(async () => {
  theme.value =
    document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (!props.authenticated) return;
  try {
    const response = await fetch("/api/v1/system");
    await requireStatus(response, 200, "system_response_invalid");
    const system = await response.json();
    if (!validSystem(system)) throw new Error("system_document_invalid");
    attention.value = [
      system.durable_core?.status !== "ready",
      system.storage?.status !== "available",
      system.backup?.status !== "current" && system.backup?.status !== "empty",
      system.bootstrap?.status !== "complete",
      !(
        system.execution_providers?.length &&
        system.execution_providers.every(
          (provider) => provider.status === "available",
        )
      ),
    ].filter(Boolean).length;
  } catch (failure) {
    attention.value = 1;
    attentionError.value =
      failure instanceof Error ? failure.message : "system_attention_invalid";
  }
});
</script>

<template>
  <LoginView
    v-if="!authenticated"
    :intended-destination="intendedDestination"
  />
  <div v-else class="qb-app-shell">
    <header class="qb-header">
      <a class="qb-brand" href="/?view=evaluations" aria-label="Quality Bar"
        >QB</a
      ><span class="qb-brand-title">Quality Bar</span>
      <nav class="qb-primary-nav" aria-label="Primary">
        <div class="qb-nav-group">
          <a
            v-for="name in ['evaluations', 'reviews', 'repositories']"
            :key="name"
            :aria-current="active(name) ? 'page' : undefined"
            :href="`/?view=${name}`"
            >{{ name[0].toUpperCase() + name.slice(1) }}</a
          >
        </div>
        <div class="qb-nav-group">
          <a
            v-for="name in ['analytics', 'system']"
            :key="name"
            :aria-current="active(name) ? 'page' : undefined"
            :href="`/?view=${name}`"
            >{{ name[0].toUpperCase() + name.slice(1) }}</a
          >
        </div>
      </nav>
      <div class="qb-header-actions">
        <button
          class="qb-theme-toggle"
          type="button"
          aria-label="Toggle theme"
          @click="toggleTheme"
        >
          {{ theme === "dark" ? "☾" : "☼" }}
        </button>
      </div>
      <a v-if="attention" class="qb-attention" href="/?view=system"
        >{{ attention }} need{{ attention === 1 ? "s" : "" }} attention</a
      >
    </header>
    <main class="qb-main">
      <p
        v-if="attentionError"
        ref="attentionErrorElement"
        role="alert"
        tabindex="-1"
      >
        {{ attentionError }}
      </p>
      <h1 class="qb-page-heading">
        {{ heading }}
      </h1>
      <component :is="component" :csrf-cookie-name="csrfCookieName" />
      <OperatorControls
        :csrf-cookie-name="csrfCookieName"
        :show-onboarding="view === 'system'"
      />
    </main>
  </div>
</template>
