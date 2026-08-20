<script setup>
import { computed, onMounted, ref } from "vue";

import AnalyticsView from "./analytics/AnalyticsView.vue";
import EvaluationDetailView from "./evaluations/EvaluationDetailView.vue";
import EvaluationsView from "./evaluations/EvaluationsView.vue";
import LoginView from "./LoginView.vue";
import OperatorControls from "./OperatorControls.vue";
import RepositoriesView from "./repositories/RepositoriesView.vue";
import RepositoryDetailView from "./repositories/RepositoryDetailView.vue";
import ReviewDetailView from "./reviews/ReviewDetailView.vue";
import ReviewsView from "./reviews/ReviewsView.vue";
import SystemView from "./system/SystemView.vue";

const props = defineProps({
  authenticated: Boolean,
  csrfCookieName: { default: "", type: String },
  intendedDestination: { default: "/", type: String },
  view: { default: "evaluations", type: String },
});
const attention = ref(0);
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
  (name === "reviews" && props.view === "review-detail") ||
  (name === "repositories" && props.view === "repository-detail");
const heading = computed(
  () => props.view[0].toUpperCase() + props.view.slice(1),
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
    if (!response.ok) return;
    const system = await response.json();
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
  } catch {
    attention.value = 1;
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
      <h1
        v-if="
          !['evaluation-detail', 'review-detail', 'repository-detail'].includes(
            view,
          )
        "
        class="qb-page-heading"
      >
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
