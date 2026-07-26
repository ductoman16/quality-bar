function readBrowserConfiguration() {
  const configuration = /** @type {HTMLScriptElement} */ (
    document.getElementById("browser-configuration")
  );
  if (configuration?.type !== "application/json") {
    throw new Error("browser_configuration_invalid");
  }
  try {
    const value = /** @type {{ intendedDestination?: unknown }} */ (
      JSON.parse(configuration.textContent)
    );
    if (
      !value ||
      typeof value.intendedDestination !== "string" ||
      !value.intendedDestination.startsWith("/") ||
      value.intendedDestination.startsWith("//")
    ) {
      throw new Error("browser_configuration_invalid");
    }
    const destination = new URL(
      value.intendedDestination,
      "http://quality-bar.internal",
    );
    if (destination.origin !== "http://quality-bar.internal") {
      throw new Error("browser_configuration_invalid");
    }
    return { intendedDestination: value.intendedDestination };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "browser_configuration_invalid"
    ) {
      throw error;
    }
    throw new Error("browser_configuration_invalid", { cause: error });
  }
}

const form = /** @type {HTMLFormElement | null} */ (
  document.getElementById("login-form")
);
const error = document.getElementById("error");
if (!form || !error) {
  throw new Error("browser_control_unavailable");
}
const { intendedDestination } = readBrowserConfiguration();
/**
 * @param {string} id
 * @returns {string}
 */
function inputValue(id) {
  const input = document.getElementById(id);
  if (!input || !("value" in input) || typeof input.value !== "string") {
    throw new Error("browser_control_unavailable");
  }
  return input.value;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const response = await fetch("/api/v1/session/login", {
    body: JSON.stringify({
      password: inputValue("password"),
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    location.assign(intendedDestination);
    return;
  }
  const body = /** @type {{ error: { message: string } }} */ (
    await response.json()
  );
  error.textContent = body.error.message;
  error.hidden = false;
});
