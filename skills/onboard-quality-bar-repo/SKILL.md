---
name: onboard-quality-bar-repo
description: Guide an agent through evidence-first onboarding of the current repository into a Quality Bar instance.
---

# Onboard a Quality Bar Repository

Onboard the current repository through one chosen Quality Bar transport. Interview the user at decision points, mutate only the repository bound to the onboarding token, and revoke the token when the run ends.

## Rules

- Use native question controls when available. Otherwise ask one material question at a time.
- Never enter, request, paste, read, or relay provider credentials. The user completes provider authentication in Firefox.
- Preserve existing Repository and Review state. Remove an existing Repository-specific Review assignment only after naming that removal in the confirmation question.
- Treat Installation-wide Reviews as mandatory. Never offer to remove them.
- Do not switch between MCP and HTTP after preflight. Stop on a transport failure.
- Keep decisions and completion evidence in the task transcript. Do not create a progress file or Quality Bar status object.

## 1. Establish the run

1. Confirm the working directory is a Git repository with a configured remote.
2. Read repository documentation, agent instructions, build scripts, test scripts, source layout, and remotes.
3. Record these completion conditions in the transcript:
   - The Repository is registered and healthy.
   - Existing Reviews are configured.
   - Approved missing Reviews, if any, are created.
   - One Evaluation covers the latest pushed default-branch commit against its first parent.
   - The user explicitly accepts the Evaluation result.
   - The onboarding token is revoked.

This step is complete when the target remote URL and the completion conditions are explicit.

## 2. Choose one transport

1. If a Quality Bar MCP server is configured, list its tools.
2. Choose MCP only when it exposes the onboarding tools. Otherwise choose HTTP.
3. Read [references/transports.md](references/transports.md). For HTTP, require `QUALITY_BAR_URL` and a private token file at `QUALITY_BAR_ONBOARDING_TOKEN_FILE`. Use `scripts/quality-bar-http.sh` for requests.
4. Make one authenticated read. Stop if authentication or transport fails.

This step is complete when one transport has made an authenticated read and the other transport is out of scope for this run.

## 3. Find or register the Repository

List Repositories. The onboarding token returns at most its bound Repository.

- If the Repository exists, confirm its URL, lifecycle, and health. Resume from current state.
- If it does not exist, read [references/provider-checkpoints.md](references/provider-checkpoints.md) and follow only the matching provider branch.

This step is complete when the bound Repository exists and is healthy. Stop on a disabled, retired, or unhealthy Repository.

## 4. Recommend existing Reviews

1. List every active Review.
2. Compare each plausibly relevant Review with concrete repository evidence from step 1.
3. Present one compact table with Review, evidence, recommendation, and assignment change. Include every proposed removal.
4. Recommend one exact subset of Repository-specific Review IDs. Installation-wide Reviews remain implicit and mandatory.
5. Ask one confirmation question for the whole subset.
6. On approval, apply the subset atomically. On rejection, revise the recommendation before mutating.

This step is complete when the confirmed subset matches Quality Bar state and no unapproved removal occurred.

## 5. Address missing Reviews

State any material repository-specific gap that existing Reviews do not cover. Ask whether to create missing Reviews.

- If the user declines, continue to the baseline Evaluation.
- If the user approves the phase, read [references/new-review-phase.md](references/new-review-phase.md). Approve and create one complete Review at a time.

This step is complete when the user declines the phase or every approved Review is present and assigned only to the bound Repository.

## 6. Run the baseline Evaluation

1. Resolve the remote default branch.
2. Resolve its latest pushed commit and that commit's first parent. Stop if either commit is unavailable.
3. Request an Evaluation with commit selectors, using the first parent as `base` and the latest pushed commit as `head`. Supply a new idempotency key.
4. Poll the Evaluation until terminal.
5. Read the complete Evaluation Result.
6. Summarize the outcome, Review Runs, and Findings with identifiers.

This step is complete when a terminal Result exists for the exact two commits.

## 7. Get explicit acceptance

Ask the user to accept or reject the baseline result.

- On acceptance, revoke the onboarding token and report the completed conditions.
- On rejection, ask what should change. Return to existing Review selection or the missing-Review phase, then run a new baseline Evaluation. Do not reuse the rejected Evaluation as completion evidence.
- On cancellation, revoke the onboarding token and report which conditions remain incomplete.

The skill is complete only after explicit acceptance and verified token revocation.
