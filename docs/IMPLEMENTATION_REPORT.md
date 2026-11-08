# Implementation report

Date: November 7, 2026

Deployment addendum: [main is now hosted in mock mode, and the dev branch has isolated live-provider configuration](DEPLOYMENTS.md). The owner authorized paid operation after the initial build. Dev's Docker image builds, all 36 current tests and four browser/API checks pass, secrets and original instrumental music are installed. Cloudflare requires Workers Paid before the renderer can be provisioned; dev generation remains paused and no paid end-to-end inference has yet been run. The historical initial-build results below describe the earlier state.

## Delivered

A working React/TypeScript/Vite application and Cloudflare Worker API, private D1/R2 storage, durable Workflows, typed fal queue integration, Workers AI descriptions/advisory review, and one FFmpeg/Pillow Container renderer. The two supplied Markdown documents are at the repository root with their relative links intact. The model decision record now distinguishes schema evidence, local media tests and the unrun real-model pilot.

The local mock path covers upload, individual framing and manual fallback, editable optional names and descriptions, per-character/batch choices, exactly three presets, immutable/idempotent generation, persisted progress/previews, a finished 20-second fixture video, native-share/copy fallback, download, public unlisted playback, owner deletion and retention cleanup. The compiler covers every cast member in moving shots, with no more than two per shot. No scene reroll, script editor, style/model selector, post-completion editing or retry endpoint exists.

Real mode is deliberately disabled. No paid inference, music purchase, provider model benchmark or production deployment was run. The committed fixture portraits/videos are original code-drawn illustrations with silent development audio; every relevant product view labels them as fixtures, not uploaded-person likenesses.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and Vite build | Passed |
| Domain/security/D1 tests | 34 passed, including all 18 preset/cast-size combinations, signature tampering, exact description mappings, concurrent budget reservations, callback-before-save/duplicates, unknown slots, retry caps, holiday retention independence and cleanup batch progress |
| Browser/API integration | 4 passed: two API scenarios, full desktop Chromium flow, full mobile WebKit flow at 360 px |
| Browser behavior | Four uploads, unavailable-detector framing confirmation, descriptions preserving typed text, blank optional names, preset persistence after reload, immutable generation, real video metadata/playback, copy-link fallback, deletion, no horizontal scrolling or unhandled page errors |
| Native media contract | 4 passed: normalization/EXIF, decoded-dimension/format rejection, all-six-character end card, 20-second H.264/AAC edit excluding an unwanted source tone |
| Durable scenario runner | 6 passed: early callback, missing callback, selective clip repair, unknown submission, exhausted retries and provider rejection |
| Selective repair evidence | Two-person failed-scene case: 6 original images, 5 total video attempts, 4 accepted clips; images were not regenerated |
| Unknown submission evidence | One attempt, no receipt, retained reservation, terminal failure; no second paid submission |
| Mock Worker dry run | Passed, no deployment |
| Real Worker/binding dry run | Passed with `--containers-rollout=none`, no deployment or Docker image build |
| Docker image | Not built locally: Docker is not installed. Dockerfile/context are supplied; CI includes an image build |
| Real fal / Workers AI / Cloudflare account integration | Not run; credentials, authorized spend and real assets were not supplied |
| Real likeness and human quality pilot | Not run; no permissioned portrait sets supplied |

The original system FFmpeg installation had a missing dynamic library. Project-local development binaries were installed and used successfully; the system installation was left unchanged. Local HTTPS fixed Safari's rejection of the Secure ownership cookie on HTTP localhost. Tests accept only the local development certificate; production cookie security was preserved.

Browser screenshots were visually inspected. See [desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png). A separate in-app preview-tab tool refused to open despite user approval; local automated browsers and saved screenshots supplied the actual UI verification instead.

## Production safeguards and observability

Owner secrets are high entropy and hashed in D1. Sources are private; inference fetch URLs are asset-scoped, expiring and signed. Share tokens are independently HMAC-derived from server secrets and stored as hashes. Every share/media request checks active render, deletion and expiry; byte-range seeking is implemented without long public caching. Signed URL query strings are redacted in configured observability, automatic invocation logs/traces are disabled, and application error logs use route templates and categories rather than raw requests or provider errors.

Known-size media outputs stream into R2 through FixedLengthStream; unknown-size fallback reads are limited to 8 MiB to protect Worker memory. Short Gemma calls explicitly disable thinking. Atomic reservations include descriptions, images, videos, advisory review and native processing. Unknown acceptance retains its reservation/slot and never triggers blind paid resubmission. Automatic repairs are project-wide and also constrained by money. Reviewer calls have a persisted two-call ceiling per attempt, even if a Workflow check step is retried. Disabling the paid-operation switch prevents new paid calls. Mock budget values are invented test values; real prices are empty.

Attempt timing fields retain observed submission/start/completion times and provider-reported inference time when present. Missing provider timings remain null. Phase events support stage and end-to-end measurements. Share-page HTTP requests, recipient playback events and create clicks have separate event names; copying a link is never counted as a recipient opening it. These instruments need a real controlled pilot before publishing latency/cost/recognition claims.

## Remaining operator inputs and limitations

- Cloudflare account/resource IDs, a final HTTPS origin, Turnstile site/secret, fal key/account ID, a strong persistent signing secret and verified conservative prices/caps. Instructions are in the README; no real secret is committed.
- Three cleared instrumental tracks with downloadable-video rights, plus real representative generated sample videos/posters. The music register is intentionally incomplete and launch-gated.
- The three-shot matched-model proof and the five-cast-set human pilot, including real portrait detection/mobile tests and likeness, gag readability, queue/runtime, retry and cost measurements. The current browser test deliberately simulates detector failure; it does not validate face detection across real people.
- Docker image build and deployed Container/Workers AI/fal callback/Turnstile smoke tests in a controlled staging account. Native rendering is verified outside Docker; the complete paid runtime is not claimed as verified.
- Advisory vision stays disabled pending calibration. No biometric identity score or automatic guarantee of recognition is provided.
- Durable recovery cannot guarantee exactly-once external execution when a submission receipt is lost. Unknown requests stop and require provider-side reconciliation if no correlated callback arrives.
- Safari/Chromium engine tests are not physical iOS/Android device tests. Production media and real photos should also be exercised on those devices during the pilot.

These limits are recorded rather than substituted with fabricated inference output, pricing or benchmark results. The mock application and deployment configuration are ready for review; production acceptance remains gated by the documented real-world inputs and pilot.
