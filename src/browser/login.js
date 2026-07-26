function readBrowserConfiguration() {
  const configuration = document.getElementById("browser-configuration");
  if (configuration?.type !== "application/json") {
    throw new Error("browser_configuration_invalid");
  }
  try {
    const value = JSON.parse(configuration.textContent);
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
    return value;
  } catch (error) {
    if (error.message === "browser_configuration_invalid") {
      throw error;
    }
    throw new Error("browser_configuration_invalid", { cause: error });
  }
}

const form = document.getElementById("login-form");
const error = document.getElementById("error");
const { intendedDestination } = readBrowserConfiguration();
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const response = await fetch("/api/v1/session/login", {
    body: JSON.stringify({
      password: document.getElementById("password").value,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    location.assign(intendedDestination);
    return;
  }
  error.textContent = (await response.json()).error.message;
  error.hidden = false;
});
