import { readSystemDeliveryFacts } from "./system-delivery-facts.ts";
import { readSystemPollingFacts } from "./system-polling-facts.ts";

export function readSystemPollingDeliveryFacts(
  durableCore: any,
  { now = () => Date.now() }: { now?: () => number } = {},
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
