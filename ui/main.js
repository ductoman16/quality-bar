import { createApp } from "vue";

import { DISPLAY_FONT_STYLE } from "../src/browser/display-font.js";
import { FONO_LCD_STYLE } from "../src/browser/style-tokens.js";
import App from "./App.vue";
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

createApp(App, JSON.parse(configuration.textContent)).mount("#app");
