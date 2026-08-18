---
name: onboard-quality-bar-repo
description: Onboard the current repository into a Quality Bar instance.
disable-model-invocation: true
---

# Onboard a Quality Bar Repository

Onboard the current repository through one Quality Bar connection method. Inspect before asking, involve the user at material decisions, mutate only the Repository bound to the onboarding token, and revoke the token when the run ends.

## Rules

- Use native question controls when available. Otherwise ask one material question at a time.
- Preserve existing Repository and Review state. Remove an existing Repository-specific Review assignment only after naming that removal in the confirmation question.
- Treat Installation-wide Reviews as mandatory. Never offer to remove them.
- After obtaining the onboarding token, perform every Quality Bar read and mutation through either MCP or HTTP for the whole run. Use browser control only for the token-creation checkpoint and stop if the selected connection fails.
- When Quality Bar requires an operator checkpoint outside the selected machine authority, give the user the exact UI steps and wait for completion.
- Keep decisions and completion evidence in the conversation. Do not create a progress file or Quality Bar status object.

## 1. Understand the Repository

1. Confirm the working directory is a Git repository with at least one configured remote.
2. Identify the exact remote to onboard. Inspect first; ask the user only when multiple remotes leave the target unclear.
3. Read the repository documentation, agent instructions, build and test scripts, source layout, and remotes.
4. Find skill and subagent definitions in the Repository that perform reviews. Record relevant review instructions as repository evidence for steps 4 and 5.
5. Summarize the evidence that matters for Review selection: the Repository's responsibilities, risky boundaries, deterministic checks, and existing review instructions.
6. Record these completion conditions in the transcript:
   - The Repository is registered and healthy.
   - Existing Reviews are configured.
   - Approved missing Reviews, if any, are created.
   - One Evaluation covers the latest pushed default-branch commit against its first parent.
   - The user approves or declines requiring the Quality Bar commit status before merge.
   - The user says the result looks good and requests no more Reviews or Criteria.
   - The onboarding token is revoked.

This step is complete when the target remote, repository evidence summary, discovered review definitions, and completion conditions are explicit.

## 2. Connect to Quality Bar

1. Determine the Quality Bar instance URL from the conversation, environment, or repository. Ask the user for it only when it is not already provided or obvious.
2. Read [references/connection-methods.md](references/connection-methods.md).
3. Use an already-selected connection method. Otherwise ask the user to choose MCP or HTTP and recommend MCP.
4. Follow only the selected connection-method branch. If it has no valid onboarding token, use the token-creation instructions in that reference to guide the user.
5. Make one authenticated read. Stop if authentication or the connection fails.

This step is complete when the instance URL is explicit, either MCP or HTTP has made an authenticated read, and the other method is out of scope for this run.

## 3. Find or register the Repository

1. List Repositories before attempting registration. The onboarding token returns at most its bound Repository.
2. If the exact Repository already exists, confirm its URL, lifecycle, and health, then resume from current state.
3. If it does not exist, read [references/provider-checkpoints.md](references/provider-checkpoints.md) and follow only the matching provider branch.
4. List Repositories again and confirm the exact Repository is active and healthy.

This step is complete when the bound Repository exists and is healthy. Stop on a disabled, retired, or unhealthy Repository.

## 4. Recommend existing Reviews

1. List every active Review in the Installation.
2. Compare every Review with concrete repository evidence from step 1.
3. In plain language, present one compact table with Review, what it checks, repository evidence, recommendation, and assignment change. Include Reviews that do not fit and every proposed removal.
4. Recommend one exact subset of Repository-specific Reviews by name; retain their IDs for the mutation. Installation-wide Reviews remain implicit and mandatory.
5. Ask one confirmation question for the whole subset.
6. On approval, apply the subset atomically. On rejection, revise the recommendation before mutating.

This step is complete when the confirmed subset matches Quality Bar state and no unapproved removal occurred.

## 5. Propose missing Reviews and Criteria

1. Map the Repository's important risks to its deterministic checks and the selected Criteria. Use relevant skill and subagent review definitions from step 1 as additional evidence.
2. Identify material repository-specific gaps that remain uncovered.
3. Present an ordered list of proposed Reviews. Under each Review, present its proposed Criteria in order with impact and repository evidence.
4. Ask whether the user wants to create any of them.
5. If the user approves any proposal, read [references/new-review-phase.md](references/new-review-phase.md), then approve and create one complete Review at a time.

If no material gap remains, say so and continue to the baseline Evaluation.

This step is complete when every identified gap is covered by a deterministic check or selected Criterion, or the user has chosen to leave it uncovered, and every approved Review is assigned only to the bound Repository.

## 6. Run the baseline Evaluation

1. Resolve the default branch of the exact remote established in step 1.
2. Resolve its latest pushed commit and that commit's first parent. Stop if either commit is unavailable.
3. Request an Evaluation with commit selectors, using the first parent as `base` and the latest pushed commit as `head`. Supply a new idempotency key.
4. Poll the Evaluation until terminal.
5. Read the complete Evaluation Result.
6. Summarize the outcome in plain language. Include every Review Run, ordered Criterion Result, and Finding with identifiers; say explicitly when there are no Findings.

This step is complete when a terminal Result exists for the exact two commits.

## 7. Propose merge protection

1. Confirm the baseline Evaluation published the `Quality Bar` commit status successfully. Stop if publication failed or remains incomplete.
2. Read the default branch's current merge protection and required checks through an available provider capability. When no direct capability exists, guide the user through the provider interface and wait for the current state.
3. In plain language, propose requiring `Quality Bar` before merge. Name the default branch, list its existing required checks, and state that every existing check and protection rule will remain unchanged.
4. Ask: "Should I require the Quality Bar check before changes can merge into `<default branch>`?"
5. Treat this question as a hard approval gate. On rejection, record that merge protection remains unchanged and continue.
6. On approval, add only the `Quality Bar` required check through an available provider capability or guide the user through the provider interface.
7. Read merge protection again. Verify that `Quality Bar` is required and every previously required check remains present.

This step is complete when the proposal and the user's decision are explicit. An approved proposal also requires verified provider state; a rejected proposal requires no mutation.

## 8. Check whether it looks good

Show the results and ask: "Does this look good? Are there any other Reviews or Criteria you'd like to set up?"

- If the user wants changes, return to existing Review selection or the missing-Review phase, then run a new baseline Evaluation. Do not reuse the earlier Evaluation as completion evidence.
- If the user says it looks good and wants no more changes, revoke the onboarding token, verify revocation, and report the completed conditions.
- On cancellation, revoke the onboarding token and report which conditions remain incomplete.

The skill is complete only after the merge-protection decision is complete, the user says the result looks good, no requested Review or Criterion work remains, and token revocation is verified. For day-to-day changes after onboarding, follow [$use-quality-bar](../use-quality-bar/SKILL.md).
