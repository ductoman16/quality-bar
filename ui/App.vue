<script setup>
import {
  FonoAppearanceControl,
  FonoAppShell,
  FonoRoot,
  FonoStatusMark,
} from "fono-ui";
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
const appearance = ref("system");
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
const navigationGroups = computed(() => [
  {
    id: "work",
    label: "Work",
    items: [
      ["evaluations", "Evaluations", "list-checks"],
      ["reviews", "Reviews", "clipboard-check"],
      ["repositories", "Repositories", "folder-git-2"],
    ].map(([id, label, icon]) => ({
      id,
      label,
      icon,
      href: `/?view=${id}`,
      current: active(id),
      primary: true,
    })),
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      ["analytics", "Analytics", "bar-chart-3"],
      ["system", "System", "settings"],
    ].map(([id, label, icon]) => ({
      id,
      label,
      icon,
      href: `/?view=${id}`,
      current: active(id),
      primary: true,
    })),
  },
]);
const setAppearance = (value) => {
  appearance.value = value;
  document.documentElement.toggleAttribute("data-theme", value !== "system");
  if (value === "system") {
    document.documentElement.removeAttribute("data-theme");
    document.cookie = "qb_theme=;path=/;max-age=0;samesite=lax";
  } else {
    document.documentElement.setAttribute("data-theme", value);
    document.cookie = `qb_theme=${value};path=/;max-age=31536000;samesite=lax`;
  }
};
onMounted(async () => {
  appearance.value =
    document.documentElement.getAttribute("data-theme") || "system";
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
  <FonoRoot :config="{ mode: 'monochrome', appearance }">
    <LoginView
      v-if="!authenticated"
      :intended-destination="intendedDestination"
    />
    <FonoAppShell
      v-else
      app-name="Quality Bar"
      brand-mark="QB"
      home-href="/?view=evaluations"
      :navigation-groups="navigationGroups"
    >
      <template v-if="attention" #status>
        <a href="/?view=system">
          <FonoStatusMark
            status="attention"
            :label="`${attention} need${attention === 1 ? '' : 's'} attention`"
          />
        </a>
      </template>
      <template #action-one>
        <FonoAppearanceControl
          :model-value="appearance"
          @update:model-value="setAppearance"
        />
      </template>
      <div class="application-page">
        <p
          v-if="attentionError"
          ref="attentionErrorElement"
          role="alert"
          tabindex="-1"
        >
          {{ attentionError }}
        </p>
        <h1 class="application-page-heading">
          {{ heading }}
        </h1>
        <component :is="component" :csrf-cookie-name="csrfCookieName" />
        <OperatorControls
          :csrf-cookie-name="csrfCookieName"
          :show-onboarding="view === 'system'"
        />
      </div>
    </FonoAppShell>
  </FonoRoot>
</template>
