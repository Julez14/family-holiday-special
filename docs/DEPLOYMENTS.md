# Deployments

## Main — hosted mock app

- URL: https://family-holiday-special.juelzlax.workers.dev
- Worker: `family-holiday-special`
- Configuration: `wrangler.production.jsonc`
- Cloudflare version: `8271bca5-f385-46af-8350-bb61a5cc1034`
- D1: `family-holiday-special` (`a5228d15-2b23-4523-89c4-46dc290cfb19`)
- Private R2: `family-holiday-special-private`
- Workflow: `family-holiday-production`
- Mode: mock; no paid image/video/text calls.
- Verified live: homepage/config/health/sample poster return 200; owner project creation returns 201; same-session recovery returns 200; deletion returns 202.

Deployment was explicitly authorized on November 7, 2026 (Toronto), after the initial local-only build. The original PRD's no-deploy default is superseded by that instruction. The signing secret was generated locally, passed through a permission-restricted temporary deployment file, stored by Cloudflare and removed from the local temporary directory. It is absent from Git.

## Dev — real services configured, activation pending

- Branch: `dev`, created from deployed `main`.
- URL: https://family-holiday-special-dev.juelzlax.workers.dev
- Worker/configuration: `family-holiday-special-dev` / `wrangler.dev.jsonc`
- Current version: `67a81828-d9e6-44cf-b347-0d15993422c2`
- D1: `family-holiday-special-dev` (`a898b3e1-6358-443f-8f62-6faa2a0b9930`); all three migrations applied.
- Private R2: `family-holiday-special-dev-private`; three original music WAVs uploaded.
- Workflow: `family-holiday-production-dev`.
- Native Workers AI binding, real fal model configuration and four secret bindings installed. Real managed Turnstile widget restricted to the dev hostname.
- Spending reservations: $20/project, $40/UTC day, two concurrent fal requests.
- Status: `MODE=real`, `PAID_GENERATION_ENABLED=false`. Frontend clearly shows that generation is paused and previews are illustrations.

The Linux/amd64 FFmpeg/Pillow image built locally. Cloudflare rejected image registration/provisioning because the account lacks Workers Paid, before any paid model test was run. The Worker/static assets/Workflow were deployed separately with `--containers-rollout=none` to provide a reviewable paused deployment. Do not mistake this partial deployment for a working native renderer. Account upgrade and a full container deploy are required before enabling paid generation or running the [live smoke test](PAID_DEVELOPMENT.md).
