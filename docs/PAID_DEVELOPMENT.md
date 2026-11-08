# Paid development deployment

The owner explicitly authorized live fal.ai and Cloudflare Workers AI costs on November 7, 2026. That instruction supersedes the initial no-deploy/no-paid defaults for this isolated `dev` deployment. It does not establish that a real-photo likeness/quality pilot has passed.

`wrangler.dev.jsonc` uses a separate Worker, Workflow, D1 database and private R2 bucket. `wrangler.jsonc` stays local and mock; `wrangler.production.jsonc` keeps the deployed `main` app mock. No automated test calls paid inference. `wrangler.real.jsonc` remains an unconfigured production launch template.

The owner enabled Workers Paid after the initial account-entitlement rejection. Container deployment is now available and the native image is deployed. [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) lists a $5/month Workers Paid minimum and included compute allowances; additional runtime/egress is usage-billed. Follow [DEPLOYMENTS.md](DEPLOYMENTS.md) for live integration-test status.

## Services and secrets

- Images: `openai/gpt-image-2.6/flare/edit` through the fal queue REST API.
- Four five-second animation clips: `minimax/h3-max/reference-to-video`, 768P, through the same queue API.
- Random descriptions: `@cf/google/gemma-4-26b-a4b-it` through the native `AI` binding. Vision review remains disabled pending calibration.
- Photo normalization, decoding and final 20-second H.264/AAC edit: the `MediaContainer` Cloudflare Container. The Worker streams private R2 inputs into it directly; native Internet access is disabled. It sleeps after two idle minutes; two instances maximum.
- Browser generation: a real managed Turnstile widget restricted to the dev hostname; server verification checks hostname and action.
- `FAL_KEY`, `ASSET_SIGNING_SECRET`, `TURNSTILE_SECRET` and `DEV_OPERATOR_SECRET` are Cloudflare secret bindings. They must never appear in Git, public configuration or logs. The existing local fal credential is transferred through a restricted temporary file and removed after deployment.
- Music: original, sample-free synthesis documented in [MUSIC.md](MUSIC.md). Paid dev previews are explicitly labeled code-drawn illustrations; real output is generated from the uploaded source.

## Spending reservations

Reservations are conservative planning allowances, not a provider invoice or an account-wide hard cap. The app enforces $20 per project, $40 per UTC day and two concurrent fal requests. Descriptions, native processing, repairs and unknown submissions also consume reservations. Uncertain submissions are never blindly resubmitted.

| Operation | Reserved USD per call |
| --- | ---: |
| GPT Image edit | 1.00 |
| H3 five-second 768P clip | 0.75 |
| Gemma description | 0.01 |
| Advisory review (disabled) | 0.02 |
| Final render | 0.50 |
| Native normalize/crop/inspection | 0.02 |

Pricing checked against primary provider pages on November 7, 2026: [GPT Image](https://fal.ai/models/openai/gpt-image-2.6/flare/edit) bills text/image tokens and varies with quality and references; its generic API quote of `$1 / units` is not a per-image price. [H3](https://fal.ai/models/minimax/h3-max/reference-to-video) publishes $0.08/second at 768P plus reference usage beyond a shared 4,096-token allowance. [Gemma](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) publishes $0.10/M input and $0.30/M output tokens. The configured reservations add headroom over the expected small requests. Recheck them after model, prompt or pricing changes. Cloudflare platform/storage/container charges and any activity outside this app are billed separately.

`PILOT_APPROVED=true` in dev records the owner's authorization for controlled live development. Production remains blocked on permissioned-photo quality testing and generated samples; dev's illustrative-preview exception cannot apply to another release channel.

## Repeatable paid smoke test

Run `node scripts/live-smoke.mjs --allow-paid` only when a paid test is intended. It uses one original code-drawn portrait, the real photo processing path, Workers AI descriptions, five fal images, four fal clips and the final renderer. It saves its cookie, fixed idempotency key and project/job IDs in ignored `.wrangler/live-smoke/state.json`. Run with `--status` to keep checking that same job. Do not erase state to retry an uncertain submission.

Two paid runs reached ready. The second ran from a fresh project without recovery, accepting all nine fal requests on revision zero; its conservative reservations totaled $8.77, not a measured bill. A new paid test can be started with `--allow-paid --fresh` only after the previous project is ready. That flag archives its private state and output before creating the next project; it refuses unfinished or uncertain jobs. No further paid test is required for the current handoff.

The smoke script uses a separate dev-only operator HMAC in place of a browser Turnstile token. It is bound to the owned project, immutable generation key and a 60-second timestamp. Ownership, origin checks, all spend reservations and immutable-job rules still apply. Normal browser requests always verify Turnstile. The operator secret is stored locally in mode-600 `.wrangler/dev-operator-secret`; remove or rotate the remote secret to revoke this access.

## Deploying

Run `npm run check`, apply `wrangler d1 migrations apply DB --remote --config wrangler.dev.jsonc`, generate/upload the three private music keys, then `npm run deploy:dev`. Wrangler preserves existing secret bindings. Deployment requires a working Docker daemon for the Linux/amd64 renderer image.

Dev uses a 100% container rollout (`rollout_step_percentage=100` and `--containers-rollout=immediate`) because Worker and native HTTP protocol changes must arrive together. A deployment command can finish before every running instance has updated. The Workflow checks the native `r2-stream-v2` health contract before buying model output, and native infrastructure failures stop the job without purchasing replacement images. If the check fails, verify the active container image/rollout before resuming the saved request. `--containers-rollout=none` is only suitable for deliberately leaving an already compatible image untouched; it cannot activate a native protocol change.

This workstation has Docker CLI/Buildx and an isolated Colima profile `holiday-builder`. Its Docker context was not made the global default. Use the profile socket explicitly:

```sh
PATH=/opt/homebrew/opt/docker/bin:$PATH colima start holiday-builder --activate=false --ssh-config=false
PATH=/opt/homebrew/opt/docker/bin:$PATH \
DOCKER_HOST=unix:///Users/julianlaxman/.colima/holiday-builder/docker.sock \
DOCKER_CONFIG="$PWD/.wrangler/docker" npm run deploy:dev
```

The project-local Docker config points to Homebrew's CLI plugins. Wrangler may add registry login credentials during deployment; remove its `auths` entry after deployment, keep the file private and never commit it. The local builder can be stopped afterward with `colima stop holiday-builder`; the deployed Cloudflare Container runs independently.
