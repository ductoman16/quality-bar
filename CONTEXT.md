# Domain Context

**Baseline Evaluation** — The Evaluation of the latest pushed default-branch commit against that commit's first parent used to establish a Repository's initial Quality Bar result.

**Onboarding** — The agent-guided process that registers one Repository, selects its applicable Reviews, optionally creates approved Repository-specific Reviews, runs a Baseline Evaluation, and ends with explicit user acceptance.

**Onboarding Token** — A verifier-only, 24-hour bearer credential bound to one normalized Repository URL. It grants only onboarding HTTP and MCP operations and is deleted on expiry or revocation.

**Repository-specific Review selection** — The complete set of active Repository-set Reviews assigned to one Repository. Updating the selection is atomic; Installation-wide Reviews always remain applicable.

**Effective Outcome** — The current Quality Bar result of an Evaluation after Findings and Waivers are applied. Its values are Pending, Clear, Advisory, Blocking, and Error.

**Clear** — An Effective Outcome with no unwaived Advisory or Blocking Findings and no Error.
_Avoid_: Passed

**Advisory** — An Effective Outcome with at least one unwaived Advisory Finding, no unwaived Blocking Findings, and no Error.

**Blocking** — An Effective Outcome with at least one unwaived Blocking Finding and no Error.
_Avoid_: Failed

**Error** — An Effective Outcome indicating that Quality Bar could not produce a trustworthy result.
_Avoid_: Failed

**Execution Status** — The lifecycle state of an Evaluation or Review Run: Queued, Running, Completed, Failed, or Cancelled. Failed describes execution, never an Effective Outcome.
