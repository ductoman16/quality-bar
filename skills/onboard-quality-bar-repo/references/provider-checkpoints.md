# Repository Provider Checkpoints

Choose one branch from the Repository remote and current Quality Bar state.

## Public Generic HTTPS

Register the exact HTTPS remote with `quality_bar.register_repository` over MCP or `POST /api/v1/onboarding/repository` over HTTP. Re-list Repositories and require healthy state.

## Credentialed Generic HTTPS

Ask the user to use the Quality Bar operator surface to register the exact remote and complete its required authentication. Resume only after the selected connection method lists the healthy Repository.

## GitHub

Ask the user to use the Quality Bar operator surface to connect or repair GitHub and select the target Repository through the provider flow. Resume only after the selected connection method lists the healthy Repository.

## Forgejo v16

Ask the user to use the Quality Bar operator surface to connect or repair Forgejo v16 and select the target Repository through the provider flow. Resume only after the selected connection method lists the healthy Repository.

If the provider cannot reach healthy state, stop. Do not register a substitute URL or downgrade to another provider type.
