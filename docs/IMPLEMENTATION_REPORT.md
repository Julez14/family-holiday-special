# Implementation report

Updated: November 7, 2026 (Toronto)

The application is built, main is hosted in mock mode, and the isolated dev deployment has completed real fal/Workers AI generation through a finished downloadable video. See [DEPLOYMENTS.md](DEPLOYMENTS.md) for resource IDs, deployed versions, the test video and measured integration results.

## Delivered

A React/TypeScript/Vite application with Cloudflare Worker API, private D1/R2 storage, durable Workflows, typed fal queue integration, Workers AI descriptions and an FFmpeg/Pillow Container renderer. Both supplied Markdown documents are at the repository root. Main and normal local development remain mock; `dev` uses real paid services under the owner's explicit authorization.

The user flow covers 1–6 individual uploads, local face-location/manual framing fallback, editable optional names and descriptions, per-character/batch description choices, three fixed presets, immutable/idempotent generation, persisted progress/previews, a finished 20-second video, sharing, download, public unlisted playback, owner deletion and retention cleanup. The compiler covers every cast member in moving shots with at most two per shot. The scope excludes scene rerolls, script editing, style/model selection and post-completion editing.

Real dev uses GPT Image 2.6 Flare Edit for canonical portraits and four frames, MiniMax H3 Max Reference-to-Video for four five-second clips, and Gemma 4 through Workers AI for descriptions. A single native renderer normalizes media, trims the clips to 18 seconds total, appends a two-second all-cast card, strips generated soundtracks and adds the selected original instrumental track. Native inputs stream privately from R2 and the container has no Internet access. Three sample-free original tracks are documented in [MUSIC.md](MUSIC.md).

## Verification

| Check | Result |
| --- | --- |
| TypeScript and Vite build | Passed |
| Domain/security/D1 tests | 38 passed, including all 18 preset/cast-size combinations, signatures, exact description mappings, concurrent reservations, callback races, retry limits, cleanup, serialized Workflow errors and native failures without replacement purchases |
| Browser/API integration | 4 passed: two API scenarios, desktop Chromium, mobile WebKit at 360 px |
| Native media contract | 8 passed: normalization/EXIF, dimensions/formats, all-six-character end card, 20-second edit/audio isolation, bounded fixed/chunked HTTP streams, private staging/render/poster/cleanup, and path/URL rejection |
| Durable scenario runner | 6 passed: early callback, missing callback, selective clip repair, unknown submission, exhausted retries and provider rejection |
| Docker/native deployment | Linux/amd64 image built and deployed; verified full rollout of the private streaming protocol |
| Live paid integration | Two completed real videos; fresh run accepted five images and four clips on revision zero with nine verified signed callbacks and no recovery |
| Fresh output | 20 seconds, 1280×720, H.264/yuv420p at 24 fps, stereo 48 kHz AAC; anonymous mobile playback, seeking, byte ranges and download passed; no page errors |
| Real-photo likeness / matched-model comparison | Not run; the integration source was an original illustrated avatar |

The fresh project completed in 202.946 seconds from creation and reserved $8.77. A prior debug project required native deployment recovery and reserved $11.39, including two unused image repairs. These are conservative application reservations, not reconciled bills or representative quality/latency benchmarks. Do not repeat paid generation merely to reconfirm these results.

The original system FFmpeg had a missing library; project-local development binaries were used without changing the system installation. Local HTTPS preserves secure ownership cookies on Safari. Browser screenshots were visually inspected; saved initial mock examples are [desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png). Engine tests are not physical-device tests.

## Safeguards and operations

Ownership secrets are high entropy and hashed in D1. Sources are private. fal reference URLs are asset-scoped, signed and expiring. Public share tokens grant playback only; every share/media request checks active render, deletion and expiry. Byte ranges support seeking without long-lived public caching. Observability redacts query strings, disables automatic invocation logs/traces and records bounded categories instead of raw signed URLs, private text or provider errors.

Known-size media outputs stream into R2; unknown-size reads have a strict fallback limit. Gemma calls disable thinking and validate exact requested character IDs. Atomic reservations cover descriptions, images, videos, review and native processing. The dev caps are $20/project, $40/UTC day and two concurrent fal requests; fixed Cloudflare costs and unrelated account activity are separate. The paid switch stops new paid operations.

Unknown provider acceptance retains its reservation/slot and is never blindly resubmitted. Known request IDs can be recovered or polled without starting another request. Technical media repairs are bounded project-wide; infrastructure/programming failures propagate without purchasing replacement images. Native protocol preflight runs before model submission, and dev uses a full container rollout to avoid mixing incompatible Worker/native versions. Attempt timing, phase events and provider timing remain distinct observations.

The dev operator smoke signature is restricted to the real dev channel and bound to project, generation key and a short timestamp. It retains ownership, origin, immutability and budget checks. Normal browser generation uses managed Turnstile. Credentials and private test state are ignored and absent from Git. Deployment and recovery instructions are in [PAID_DEVELOPMENT.md](PAID_DEVELOPMENT.md).

## Remaining quality acceptance work

- Run the matched-model proof and permissioned five-cast-set human pilot in [PILOT.md](PILOT.md), with real-photo framing, recognizable faces, stable cast count, readable gags and measured retries/costs. One debug shot duplicated a single character; decoding successfully does not establish visual correctness.
- Replace dev's clearly labeled illustrative preset previews with representative generated examples before a public real-mode launch. Main stays mock and the production launch template stays unconfigured.
- Exercise a normal human browser through the real Turnstile challenge, and test real photos/playback on physical iOS/Android devices. The paid integration script used the scoped operator signature.
- Keep advisory vision disabled until calibrated. No biometric identity score or automatic recognition guarantee is supplied.
- Reconcile actual provider/platform bills before claiming cost per accepted cartoon. A lost external submission receipt cannot provide exactly-once execution; it stops for reconciliation rather than risking a duplicate charge.

The requested build, main deployment and live dev integrations are complete. The separate real-photo quality pilot remains unclaimed.
