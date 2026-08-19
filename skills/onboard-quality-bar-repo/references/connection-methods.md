# Quality Bar Connection Methods

Repository list responses contain exactly `items` and `next_cursor`.

## Create an onboarding token

Use this checkpoint when the selected connection method has no valid onboarding token:

When browser-control capabilities are available, offer to perform these token-creation steps for the user. Stop browser control after the token is available to the selected connection method. Otherwise, give the user these instructions and wait.

1. Open the Quality Bar instance and sign in.
2. Select **System**, then expand **Operator**.
3. Find **Onboarding tokens**.
4. If the exact Repository already has an active token but its shown-once value is unavailable, select **Revoke** for that token before creating another.
5. Enter the exact HTTPS Repository URL in **Repository URL**.
6. Select **Create onboarding token**.
7. The **Onboarding token** dialog shows the value once. Make it available to the selected connection method before selecting **Done**.
8. Tell the agent when the token is available so it can retry the authenticated read.

An onboarding token is bound to that Repository and expires after 24 hours. This checkpoint is complete when the selected connection method can make an authenticated read with the new token.

## MCP

Use the MCP tool input schema as the authority for MCP payloads. The complete onboarding tool set is:

- `quality_bar.list_repositories`
- `quality_bar.list_reviews`
- `quality_bar.get_repository_guidance`
- `quality_bar.register_repository`
- `quality_bar.set_repository_reviews`
- `quality_bar.create_repository_review`
- `quality_bar.update_repository_review_metadata`
- `quality_bar.save_repository_review_version`
- `quality_bar.request_evaluation`
- `quality_bar.get_evaluation`
- `quality_bar.get_evaluation_result`
- `quality_bar.revoke_onboarding_token`

### Bootstrap checkpoint

When MCP is selected and any onboarding tool is absent:

1. Require the Quality Bar instance URL.
2. Complete **Create an onboarding token** above.
3. Configure the platform's MCP client for the instance's `/mcp/v1` endpoint with bearer authentication.
4. Reload or restart the agent context as required by the platform.

The checkpoint is complete only when every onboarding tool is visible in the new context. Missing tools stop the run; HTTP remains a separate user-selected connection method.

## HTTP

Use an available HTTP client with the Quality Bar instance URL and Repository-bound onboarding token. Send the token as bearer authentication and use these routes:

| Action                    | Request                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List the bound Repository | `GET /api/v1/repositories`                                                                                                                                    |
| List active Reviews       | `GET /api/v1/reviews`                                                                                                                                         |
| Read guidance             | `GET /api/v1/repositories/{repository_id}/guidance`                                                                                                           |
| Register public HTTPS     | `POST /api/v1/onboarding/repository {"url":"..."}`                                                                                                            |
| Set Review selection      | `PUT /api/v1/repositories/{repository_id}/review-selection {"review_ids":[...]}`                                                                              |
| Create a Review           | `POST /api/v1/repositories/{repository_id}/reviews {complete_review}`                                                                                         |
| Update Review metadata    | `PATCH /api/v1/onboarding/reviews/{review_id}/metadata {"name":"...","description":"..."}`                                                                    |
| Save a Review version     | `POST /api/v1/onboarding/reviews/{review_id}/versions {complete_version}`                                                                                     |
| Request an Evaluation     | `POST /api/v1/repositories/{repository_id}/evaluations {"base":{"type":"commit","value":"..."},"head":{"type":"commit","value":"..."}} --idempotency-key KEY` |
| Poll an Evaluation        | `GET /api/v1/evaluations/{evaluation_id}`                                                                                                                     |
| Read its Result           | `GET /api/v1/evaluations/{evaluation_id}/result`                                                                                                              |
| Revoke this token         | `POST /api/v1/onboarding-token/revoke {}`                                                                                                                     |

Treat any non-success response as a hard failure. The routes above are the complete HTTP scope of this onboarding workflow.
