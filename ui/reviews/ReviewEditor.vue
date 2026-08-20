<script setup>
import { computed, reactive, watch } from "vue";

const props = defineProps({
  models: { required: true, type: Array },
  snapshot: { default: () => ({}), type: Object },
  submitLabel: { default: "Save", type: String },
});
const emit = defineEmits(["save"]);
const form = reactive({
  applicabilityRule: "",
  criteria: [],
  model: "",
  reasoningEffort: "",
  serviceTier: "",
});
const capability = computed(() =>
  props.models.find(({ id }) => id === form.model),
);
const reset = () => {
  const configuration = props.snapshot.codex_configuration ?? {};
  form.applicabilityRule = props.snapshot.applicability_rule ?? "";
  form.criteria = (
    props.snapshot.criteria ?? [{ impact: "blocking", instruction: "" }]
  ).map((criterion) => ({ ...criterion }));
  form.model = configuration.model ?? props.models[0]?.id ?? "";
  form.reasoningEffort =
    configuration.reasoning_effort ??
    capability.value?.reasoning_efforts?.[0] ??
    "";
  form.serviceTier =
    configuration.service_tier ?? capability.value?.service_tiers?.[0] ?? "";
};
watch(() => [props.snapshot, props.models], reset, {
  deep: true,
  immediate: true,
});
watch(
  () => form.model,
  () => {
    if (!capability.value?.reasoning_efforts.includes(form.reasoningEffort))
      form.reasoningEffort = capability.value?.reasoning_efforts?.[0] ?? "";
    if (!capability.value?.service_tiers.includes(form.serviceTier))
      form.serviceTier = capability.value?.service_tiers?.[0] ?? "";
  },
);
function move(index, offset) {
  const [criterion] = form.criteria.splice(index, 1);
  form.criteria.splice(index + offset, 0, criterion);
}
function save() {
  emit("save", {
    applicability_rule: form.applicabilityRule || null,
    codex_configuration: {
      model: form.model,
      reasoning_effort: form.reasoningEffort,
      service_tier: form.serviceTier,
    },
    criteria: form.criteria.map((criterion) => ({
      ...(criterion.id && { id: criterion.id }),
      impact: criterion.impact,
      instruction: criterion.instruction,
    })),
  });
}
</script>

<template>
  <form class="review-editor" @submit.prevent="save">
    <ol class="review-criteria">
      <li
        v-for="(criterion, index) in form.criteria"
        :key="criterion.id ?? index"
      >
        <label :for="`criterion-${index}`">Criterion {{ index + 1 }}</label
        ><textarea
          :id="`criterion-${index}`"
          v-model="criterion.instruction"
          required
        ></textarea
        ><select v-model="criterion.impact">
          <option value="blocking">Blocking</option>
          <option value="advisory">Advisory</option></select
        ><button
          :disabled="index === 0"
          type="button"
          aria-label="Move Criterion up"
          @click="move(index, -1)"
        >
          ↑</button
        ><button
          :disabled="index === form.criteria.length - 1"
          type="button"
          aria-label="Move Criterion down"
          @click="move(index, 1)"
        >
          ↓</button
        ><button
          :disabled="form.criteria.length === 1"
          type="button"
          aria-label="Remove Criterion"
          @click="form.criteria.splice(index, 1)"
        >
          −
        </button>
      </li>
    </ol>
    <button
      type="button"
      aria-label="Add Criterion"
      @click="form.criteria.push({ impact: 'blocking', instruction: '' })"
    >
      + Criterion
    </button>
    <label for="review-applicability-rule">Applicability rule</label
    ><textarea
      id="review-applicability-rule"
      v-model="form.applicabilityRule"
    ></textarea>
    <label for="review-model">Codex model</label
    ><select id="review-model" v-model="form.model" required>
      <option v-for="model in models" :key="model.id" :value="model.id">
        {{ model.id }}
      </option>
    </select>
    <label for="review-reasoning">Reasoning effort</label
    ><select id="review-reasoning" v-model="form.reasoningEffort" required>
      <option v-for="value in capability?.reasoning_efforts" :key="value">
        {{ value }}
      </option>
    </select>
    <label for="review-tier">Service tier</label
    ><select id="review-tier" v-model="form.serviceTier" required>
      <option v-for="value in capability?.service_tiers" :key="value">
        {{ value }}
      </option>
    </select>
    <button class="qb-btn qb-btn--primary" type="submit">
      {{ submitLabel }}
    </button>
  </form>
</template>
