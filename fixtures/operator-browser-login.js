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
  const forgejoForm = document.getElementById("forgejo-connection-form");
  const forgejoBaseUrl = document.getElementById("forgejo-connection-base-url");
  const forgejoToken = document.getElementById("forgejo-connection-token");
  const forgejoError = document.getElementById("forgejo-connection-error");

  if (
    !(forgejoForm instanceof HTMLFormElement) ||
    !(forgejoBaseUrl instanceof HTMLInputElement) ||
    !(forgejoToken instanceof HTMLInputElement) ||
    !(forgejoError instanceof HTMLParagraphElement)
  ) {
    throw new Error("operator_browser_forgejo_controls_missing");
  }

  forgejoBaseUrl.value = "https://forgejo.invalid";
  forgejoBaseUrl.dispatchEvent(new Event("input", { bubbles: true }));
  forgejoToken.value = "controlled-invalid-token";
  forgejoToken.dispatchEvent(new Event("input", { bubbles: true }));
  forgejoForm.requestSubmit();

  const reportError = () => {
    if (!forgejoError.hidden) {
      void fetch(
        `/operator-browser-complete?${new URLSearchParams({
          error: forgejoError.textContent?.trim() ?? "",
          path: `${location.pathname}${location.search}`,
        })}`,
      );
      return;
    }
    setTimeout(reportError, 10);
  };
  reportError();
});
