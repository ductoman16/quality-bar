import { readSystemDeliveryFacts } from "./system-delivery-facts.js";
import { readSystemPollingFacts } from "./system-polling-facts.js";

/** @param {any} durableCore @param {{now?: () => number}} [options] */
export function readSystemPollingDeliveryFacts(
  durableCore,
  { now = () => Date.now() } = {},
) {
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("now must return a nonnegative integer timestamp");
  }
  return {
    delivery: readSystemDeliveryFacts(durableCore, {
      now: () => timestamp,
    }),
    polling: { connections: readSystemPollingFacts(durableCore) },
  };
}
