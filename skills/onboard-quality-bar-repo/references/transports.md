# Onboarding Transports

Use the MCP tool input schema as the authority for MCP payloads. The onboarding tool set is:

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

For HTTP, call `scripts/quality-bar-http.sh METHOD PATH JSON`. Use these routes:

| Action | Request |
| --- | --- |
| List the bound Repository | `GET /api/v1/repositories` |
| List active Reviews | `GET /api/v1/reviews` |
| Read guidance | `GET /api/v1/repositories/{repository_id}/guidance` |
| Register public HTTPS | `POST /api/v1/onboarding/repository {"url":"..."}` |
| Set Review selection | `PUT /api/v1/repositories/{repository_id}/review-selection {"review_ids":[...]}` |
| Create a Review | `POST /api/v1/repositories/{repository_id}/reviews {complete_review}` |
| Update Review metadata | `PATCH /api/v1/onboarding/reviews/{review_id}/metadata {"name":"...","description":"..."}` |
| Save a Review version | `POST /api/v1/onboarding/reviews/{review_id}/versions {complete_version}` |
| Request an Evaluation | `POST /api/v1/repositories/{repository_id}/evaluations {"base":{"type":"commit","value":"..."},"head":{"type":"commit","value":"..."}} --idempotency-key KEY` |
| Poll an Evaluation | `GET /api/v1/evaluations/{evaluation_id}` |
| Read its Result | `GET /api/v1/evaluations/{evaluation_id}/result` |
| Revoke this token | `POST /api/v1/onboarding-token/revoke {}` |

Treat any non-success response as a hard failure. Never call provider-credential, lifecycle, waiver, retry, or system routes with an onboarding token.
