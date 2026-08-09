# Domain Context

**Baseline Evaluation** — The Evaluation of the latest pushed default-branch commit against that commit's first parent used to establish a Repository's initial Quality Bar result.

**Onboarding** — The agent-guided process that registers one Repository, selects its applicable Reviews, optionally creates approved Repository-specific Reviews, runs a Baseline Evaluation, and ends with explicit user acceptance.

**Onboarding Token** — A verifier-only, 24-hour bearer credential bound to one normalized Repository URL. It grants only onboarding HTTP and MCP operations and is deleted on expiry or revocation.

**Repository-specific Review selection** — The complete set of active Repository-set Reviews assigned to one Repository. Updating the selection is atomic; Installation-wide Reviews always remain applicable.
