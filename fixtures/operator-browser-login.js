window.addEventListener("DOMContentLoaded", () => {
  const password = document.getElementById("password");
  const loginForm = document.getElementById("login-form");
  if (
    password instanceof HTMLInputElement &&
    loginForm instanceof HTMLFormElement
  ) {
    password.value = "a correct operator password";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    loginForm.requestSubmit();
    return;
  }
  const submitForgejo = () => {
    const form = document.getElementById("forgejo-connection-form");
    const baseUrl = document.getElementById("forgejo-connection-base-url");
    const token = document.getElementById("forgejo-connection-token");
    const error = document.getElementById("repository-error");
    if (
      !(form instanceof HTMLFormElement) ||
      !(baseUrl instanceof HTMLInputElement) ||
      !(token instanceof HTMLInputElement) ||
      !(error instanceof HTMLParagraphElement)
    ) {
      setTimeout(submitForgejo, 10);
      return;
    }
    baseUrl.value = "https://forgejo.invalid";
    baseUrl.dispatchEvent(new Event("input", { bubbles: true }));
    token.value = "controlled-invalid-token";
    token.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();

    const reportError = () => {
      if (!error.hidden) {
        void fetch(
          `/operator-browser-complete?${new URLSearchParams({
            error: error.textContent?.trim() ?? "",
            path: `${location.pathname}${location.search}`,
          })}`,
        );
        return;
      }
      setTimeout(reportError, 10);
    };
    reportError();
  };
  submitForgejo();
});
