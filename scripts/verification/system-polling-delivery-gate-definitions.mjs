export const SYSTEM_POLLING_DELIVERY_GATE_DEFINITIONS = [
  {
    name: "system-polling-delivery-unit",
    testGroup:
      "system-connection-repository-polling-baselines-and-durable-delivery-surface-state-with-exact-owning-errors",
    failureCode: "system_polling_delivery_unit_tests_failed",
    arguments: [
      "--test",
      "test/system-polling-delivery-facts.test.js",
      "test/system-polling-delivery-durable-integrity.test.js",
      "test/system-polling-delivery-polling-integrity.test.js",
      "test/system-polling-delivery-verification.test.js",
    ],
  },
  {
    name: "system-polling-delivery-browser-component",
    testGroup:
      "system-polling-delivery-component-states-and-owning-resource-identity",
    failureCode: "system_polling_delivery_browser_component_tests_failed",
    arguments: [
      "--test",
      "test/system-polling-delivery-browser-component.test.js",
    ],
  },
  {
    name: "system-polling-delivery-http-integration",
    testGroup:
      "authenticated-system-api-polling-and-delivery-facts-from-durable-sqlite-state",
    failureCode: "system_polling_delivery_http_integration_tests_failed",
    arguments: [
      "--test",
      "test/system-polling-delivery-http-integration.test.js",
    ],
  },
];
