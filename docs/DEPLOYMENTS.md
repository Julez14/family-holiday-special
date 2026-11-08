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

## Dev — live fal and Workers AI verified

- Branch: `dev`, created from deployed `main`; not merged back into main.
- URL: https://family-holiday-special-dev.juelzlax.workers.dev
- Worker/configuration: `family-holiday-special-dev` / `wrangler.dev.jsonc`
- Cloudflare version: `5fe9672e-3325-4c0c-a09a-a1516c95e387`
- D1: `family-holiday-special-dev` (`a898b3e1-6358-443f-8f62-6faa2a0b9930`); all three migrations applied.
- Private R2: `family-holiday-special-dev-private`; three original instrumental WAVs installed.
- Active Workflow: `family-holiday-special-dev-production` / `LiveProductionWorkflow`. The earlier prototype Workflow is no longer bound to the app.
- Container application: `family-holiday-special-dev-mediacontainer` (`a033c312-4ed8-4d0e-8261-951939fd398e`), standard-2, two instances maximum, two-minute idle sleep, Internet disabled.
- Verified native image: `sha256:2a99bc86f51e2b6a7024a6016fa2e0ed3384dd4d32fd99681334ce13fce7f626` in the account's Cloudflare registry.
- Native Workers AI binding; real fal models and four secret bindings installed. Managed Turnstile is restricted to the dev hostname. No secret is committed.
- Status: `MODE=real`, `PAID_GENERATION_ENABLED=true`. The owner explicitly authorized paid development and enabled Workers Paid.
- Spending reservations: $20/project, $40/UTC day, two concurrent fal requests. These are application planning caps, not exact provider bills or total Cloudflare billing limits.

### Live integration evidence — November 7, 2026 (Toronto)

Two real projects reached ready. Both used an original code-drawn avatar rather than a person's photo. The first required controlled recovery while fixing the native deployment; it reused saved receipts and completed seven image requests (including two unused repairs) and four video requests. No unknown provider acceptance was blindly resubmitted. Its conservative reservations totaled $11.39.

The fresh project `2eed6d86-89a3-4735-be68-012083f14935` completed without SQL changes, manual recovery or replacement attempts:

1. Private upload, native normalization and manual framing.
2. A real Gemma description through Workers AI.
3. Five accepted GPT Image results: one canonical portrait and four scene frames.
4. Four accepted five-second H3 clips. All nine fal attempts were revision zero, with nine verified signed `OK` callbacks.
5. Native final assembly and poster; project reached ready in 202.946 seconds from creation. This is one integration observation, not a service-level promise.

The fresh run reserved $8.77 across inference and native operations; actual account charges were not reconciled. Its downloaded output is exactly 20 seconds, 1280×720, 24 fps, H.264/yuv420p, with one 48 kHz stereo AAC stream. Anonymous Chromium at a 390 px mobile viewport passed playback, seeking to 19 seconds, HTTP 206 byte ranges, and HTTP 200 attachment download with no page errors. The first output's decoded audio correlated with the selected original track at 0.999997; generated clip soundtracks are excluded by the render mapping.

[Watch the generated test cartoon](https://family-holiday-special-dev.juelzlax.workers.dev/s/474d1f5a651984adcb42e9e1e81a32866a890fa53e8a7ce91efd239893b3de77). It is unlisted synthetic test content and remains subject to normal retention. Owner cookies, local test state, raw provider output and diagnostics stay in ignored `.wrangler/` files.

These results verify service integration, not real-photo likeness, multi-person quality or matched-model superiority. One debug output duplicated the single character within a shot. Advisory vision remains disabled pending calibration. The paid smoke script uses a narrowly scoped dev operator signature; a human browser run through the real Turnstile challenge and real-photo pilot remain separate acceptance checks.

### Deployment issue resolved

The initial account lacked Workers Paid. After upgrade, a native service that fetched public signed URLs encountered HTTP 403. Private R2 byte streaming removed that public HTTP dependency. A gradual container rollout also left an older image serving requests; a full rollout activated the verified `r2-stream-v2` image. Future dev deployments use 100% rollout, versioned inspector/renderer names and protocol preflight before any new paid image/video call. Native infrastructure failures propagate without buying replacement model output. See [operations](PAID_DEVELOPMENT.md) and [architecture](ARCHITECTURE.md).
