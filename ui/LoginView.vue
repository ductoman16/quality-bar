<script setup>
import { nextTick, ref } from "vue";

import { responseMessage } from "./browser.ts";

const props = defineProps({
  intendedDestination: { default: "/", type: String },
});
const password = ref("");
const error = ref("");
const errorElement = ref();
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    const response = await fetch("/api/v1/session/login", {
      body: JSON.stringify({ password: password.value }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (response.ok && response.status === 204) {
      location.assign(props.intendedDestination);
      return;
    }
    if (response.ok) throw new Error("login_response_invalid");
    error.value = await responseMessage(response);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "Login failed";
  } finally {
    busy.value = false;
    if (error.value) {
      await nextTick();
      errorElement.value?.focus();
    }
  }
}
</script>

<template>
  <main class="qb-login">
    <div class="qb-login__card">
      <div class="qb-login__brand">
        <span class="qb-brand">QB</span
        ><span class="qb-login__title">Quality Bar</span>
      </div>
      <form id="login-form" class="qb-login__form" @submit.prevent="submit">
        <label for="password">Password</label>
        <input
          id="password"
          v-model="password"
          autocomplete="current-password"
          required
          type="password"
        />
        <button class="qb-btn qb-btn--primary" :disabled="busy" type="submit">
          Log in
        </button>
        <p v-if="error" ref="errorElement" role="alert" tabindex="-1">
          {{ error }}
        </p>
      </form>
    </div>
  </main>
</template>
