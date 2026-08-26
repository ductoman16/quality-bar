import { createApp } from "vue";

import { DISPLAY_FONT_STYLE } from "../src/browser/display-font.ts";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.ts";
import App from "./App.vue";
import { validBrowserConfiguration } from "./contract.ts";
import "./ui.css";
import "./views.css";

document.head.insertAdjacentHTML(
  "beforeend",
  DISPLAY_FONT_STYLE + FONO_LCD_STYLE,
);

const configuration = document.getElementById("browser-configuration");
if (configuration?.getAttribute("type") !== "application/json") {
  throw new Error("browser_configuration_invalid");
}
let browserConfiguration;
try {
  browserConfiguration = JSON.parse(configuration.textContent);
  if (!validBrowserConfiguration(browserConfiguration)) {
    throw new Error("browser_configuration_invalid");
  }
} catch (failure) {
  if (
    failure instanceof Error &&
    failure.message === "browser_configuration_invalid"
  ) {
    throw failure;
  }
  throw new Error("browser_configuration_invalid", { cause: failure });
}
createApp(App, browserConfiguration).mount("#app");
