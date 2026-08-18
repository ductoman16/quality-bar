---
name: use-quality-bar
description: "Use Quality Bar during normal repository work: read Repository Guidance, run an Evaluation, act on Findings, or request a Waiver. Use after onboarding whenever Quality Bar governs a change or the user asks about an Evaluation or Waiver."
---

# Use Quality Bar

Quality Bar runs Reviews against an exact Repository change, records immutable Results and Findings, and publishes status and feedback to its Forge. For a Repository that is not onboarded, ask the user to invoke [$onboard-quality-bar-repo](../onboard-quality-bar-repo/SKILL.md) first.

Operate through one machine interface for the run: MCP when configured, otherwise HTTP. Browser control is limited to obtaining a token. Stop on connection or authentication errors.

1. **Read guidance.** Identify the exact Repository and Quality Bar instance. Read its current Repository Guidance before editing. Done when the `guidance_revision`, active Reviews, and Criteria are accounted for.
2. **Prepare the change.** Implement and test the change, push it, and resolve the exact base and head commits. Done when both commits exist in the Forge.
3. **Evaluate.** Create an Evaluation for those commits with a new idempotency key. Poll until terminal, then read the complete Evaluation Result. Done when the terminal Result is read.
4. **Act on Findings.** Fix blocking Findings. For each advisory Finding, fix it, accept it as advisory, or propose a Waiver Request. A changed head returns to step 2. Done when every Finding has a recorded disposition.
5. **Adjudicate a waiver.** Only advisory Findings are eligible. Submit the user-approved rationale, poll the Waiver Adjudication until terminal, and read every Waiver Decision. Done when every request has a terminal Decision.
6. **Finish.** Report the exact head, Result, Findings, Waiver Decisions, and Forge publication state. Done when the current head has a terminal Result and publication is complete.
