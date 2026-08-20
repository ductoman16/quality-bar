import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  root: "ui",
  build: { emptyOutDir: true, outDir: "../dist" },
  test: { environment: "jsdom" },
});
