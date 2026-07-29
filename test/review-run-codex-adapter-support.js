import { runReviewRunCodex as runCodexAdapter } from "../src/review-run-codex-adapter.js";

/** @param {Omit<Parameters<typeof runCodexAdapter>[0], "startRun"> & {startRun?: () => unknown}} options */
export const runReviewRunCodex = (options) =>
  runCodexAdapter({ ...options, startRun: options.startRun ?? (() => {}) });
