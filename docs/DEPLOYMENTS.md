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
