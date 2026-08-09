# Repository Provider Checkpoints

Choose one branch from the Repository remote and current Quality Bar state.

## Public Generic HTTPS

Register the exact HTTPS remote with `quality_bar.register_repository` over MCP or `POST /api/v1/onboarding/repository` over HTTP. Re-list Repositories and require healthy state.

## Credentialed Generic HTTPS

Open the Quality Bar operator surface in Firefox. Ask the user to register the exact remote and enter its username and token there. Never ask the user to send either credential to the agent. Resume only after the onboarding transport lists the healthy Repository.

## GitHub

Open the Quality Bar operator surface in Firefox. Ask the user to connect or repair GitHub and select the target Repository through the existing provider flow. Provider authorization stays in the browser. Resume only after the onboarding transport lists the healthy Repository.

## Forgejo v16

Open the Quality Bar operator surface in Firefox. Ask the user to connect or repair Forgejo v16 and select the target Repository through the existing provider flow. The user enters the PAT in the browser. Resume only after the onboarding transport lists the healthy Repository.

If the provider cannot reach healthy state, stop. Do not register a substitute URL or downgrade to another provider type.
