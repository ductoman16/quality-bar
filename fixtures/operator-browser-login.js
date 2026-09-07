window.addEventListener("DOMContentLoaded", () => {
  const password = document.getElementById("password");
  const loginForm = document.getElementById("login-form");
  if (
    password instanceof HTMLInputElement &&
    loginForm instanceof HTMLFormElement
  ) {
    window.name =
      new URLSearchParams(location.search).get("viewport") ?? "unknown";
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
      !(error instanceof HTMLParagraphElement) ||
      form.closest("[inert]")
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
        window.name = `${window.name.split("\n", 1)[0]}\n${error.textContent?.trim() ?? ""}`;
        const navigateToSystem = () => {
          const systemLink = [...document.querySelectorAll("a")].find(
            (link) =>
              link.getAttribute("href") === "/?view=system" &&
              link instanceof HTMLElement &&
              link.offsetParent !== null,
          );
          if (systemLink instanceof HTMLAnchorElement) {
            systemLink.click();
            return;
          }
          const menu = document.querySelector(
            '.fono-app-shell__menu[aria-label="Open navigation"]',
          );
          if (menu instanceof HTMLButtonElement) {
            menu.click();
          }
          setTimeout(navigateToSystem, 10);
        };
        navigateToSystem();
        return;
      }
      setTimeout(reportError, 10);
    };
    reportError();
  };
  if (new URLSearchParams(location.search).get("view") === "system") {
    const reportLayout = () => {
      if (!(document.querySelector(".sys-summary") instanceof HTMLElement)) {
        setTimeout(reportLayout, 10);
        return;
      }
      const [viewport = "unknown", storedError = ""] = window.name.split("\n");
      void fetch(
        `/operator-browser-complete?${new URLSearchParams({
          error: storedError,
          path: `${location.pathname}${location.search}`,
          viewport,
          width: String(window.innerWidth),
        })}`,
      );
    };
    reportLayout();
  } else {
    submitForgejo();
  }
});
