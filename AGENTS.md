# AGENTS.md

## File naming

Modules use `kebab-case.ts`. Vue components and TS classes use `PascalCase.vue` / `PascalCase.ts`.

A filename names one exported concept. When a name needs three or more hyphen-joined qualifiers, the code inside wants a subfolder, not a longer name: `submission/channel.ts`, not `submission-channel-surface.ts`.

One primary export per file. The primary export's name matches the filename.
