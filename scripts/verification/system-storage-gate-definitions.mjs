export const SYSTEM_STORAGE_FACTS_GATE_DEFINITIONS = [
  {
    name: "system-storage-facts-unit",
    testGroup:
      "system-storage-identity-cleanup-backup-migration-and-exact-failure-facts",
    failureCode: "system_storage_facts_unit_tests_failed",
    arguments: [
      "--test",
      "test/system-storage-facts.test.js",
      "test/system-storage-verification.test.js",
    ],
  },
  {
    name: "system-storage-facts-browser-component",
    testGroup:
      "system-storage-cleanup-backup-migration-states-without-operational-controls",
    failureCode: "system_storage_facts_browser_component_tests_failed",
    arguments: ["--test", "test/system-storage-browser-component.test.js"],
  },
  {
    name: "system-storage-facts-http-integration",
    testGroup:
      "authenticated-system-api-storage-identity-cleanup-backup-and-migration-facts",
    failureCode: "system_storage_facts_http_integration_tests_failed",
    arguments: ["--test", "test/system-storage-http-integration.test.js"],
  },
];
