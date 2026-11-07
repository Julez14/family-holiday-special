# Model Selection Decisions — Family Christmas Cartoon

Date: November 7, 2026  
Version: 0.1  
Status: Initial decisions; subject to testing and revision  
Related document: [Family Christmas Cartoon PRD](Family_Christmas_Cartoon_PRD.md)

## How to read this document

This records our initial model choices and the reasoning behind them. It is not a claim that these are the best available models, a report of completed benchmarks, or a requirement to keep these exact endpoints forever.

The product requirements in the PRD are the goal. Model names are starting implementation choices. The build agent may recommend or adopt a better-fitting supported model when evidence supports the change, while preserving the agreed product behavior, provider preferences, interfaces, and spending limits. Record the change and its evidence here rather than silently treating an initial choice as permanent.

No project-specific generations or quality benchmarks have been run for this record. Capabilities and prices below come from provider documentation checked on the date above. Quality, latency, and cost per accepted output remain to be measured using our actual portraits, cartoon style, and gags.

## What we are optimizing for

- Recognizable cartoon versions of the uploaded people.
- One consistent Looney Tunes animation style across portraits and moving shots.
- Readable, exaggerated visual comedy that works without dialogue or sound.
- Stable appearance and wardrobe across short scenes containing one or two people.
- Low setup friction, manageable generation cost, and dependable completion.
- fal for media generation and Cloudflare for the remaining application services.

The MVP has up to six people, three fixed gag presets, and approximately 20 seconds of finished video. It uses individual portraits, editable character descriptions, and instrumental music. We do not need models for speech, music generation, freeform story writing, or per-person training.

## Initial selection at a glance

| Role | Initial choice | Why we started here | Still to validate |
| --- | --- | --- | --- |
| Cartoon portraits and scene starting frames | GPT Image 2.6 Flare Edit on fal | Reference editing, output controls, and a straightforward fit for establishing each character and scene before animation | Likeness, exact style adherence, speed, and cost against Nano Banana 2.1 |
| Animate scenes | MiniMax H3 Max Reference-to-Video on fal | Accepts a starting frame together with subject/style references; attractive published base clip price | Whether faces remain recognizable during exaggerated motion |
| Random character descriptions | Gemma 4 26B A4B on Cloudflare Workers AI | A currently recommended smaller-workload option with low published token rates | Varied, funny descriptions, valid structured output, and actual latency |
| Advisory visual checks | The same Gemma 4 model | Its documented vision support lets us begin with one model integration for text and visual review | Whether it catches genuine failures without rejecting intentional cartoon exaggeration |
| Portrait face location and framing | MediaPipe Face Detector with BlazeFace Short-Range in the browser | A small local face-location task suited to the required clear individual portraits | Mobile behavior and detection errors on the supported photo conditions |

There are four initially selected model types. Gemma serves two separate roles. The alternatives below are comparison candidates, not extra models to run for every user generation.

## 1. GPT Image 2.6 Flare Edit

Initial endpoint: `openai/gpt-image-2.6/flare/edit`  
Provider: fal  
Used for: one canonical cartoon portrait per person and one starting image per moving shot

### Why this was our initial decision

We want control over appearance and composition before paying to animate a scene. Reference-image editing fits that pipeline. The documented endpoint accepts multiple reference images and offers explicit output dimensions, quality settings, and transparent-background output [1].

Those controls let us provide original portraits, accepted cartoon looks, and style references together. Transparent or clean-background portraits also help assemble the final cast card without generating another group image.

This is a capability-fit decision, not proof that this model preserves likeness better than alternatives. The original source portrait stays associated with each character throughout the pipeline; generated references can introduce drift.

### What could change this choice

Nano Banana 2.1 Edit (`google/nano-banana-2.1/edit`) is the first comparison candidate. Its API supports multiple reference images and reusable system instructions. fal also publishes representative short-prompt 1K edit costs around US$0.04; actual charges depend on input references and settings [2]. This is useful planning evidence, not a matched-quality cost comparison against GPT Image.

Use the same permissioned portraits, target style, descriptions, and scene compositions to compare them. Prefer the model with the best combination of recognizable faces, consistent style, usable composition, latency, and cost per accepted image. Keep GPT Image if its quality or output controls justify its cost. Switch if Nano Banana produces equivalent or better results more efficiently. Test transparent-output needs explicitly if that feature affects the renderer.

Do not introduce two image models into every production job merely because both were evaluated. A split portrait/scene setup is possible later only if measured benefits justify the extra integration.

## 2. MiniMax H3 Max Reference-to-Video

Initial endpoint: `minimax/h3-max/reference-to-video`  
Provider: fal  
Used for: four short animated scenes, generated independently

### Why this was our initial decision

H3 Max accepts an explicit starting frame (`image_url`) alongside subject/style reference images. This matches the plan to establish a scene as a still image, then animate it while retaining character references. Its optional ending-frame input gives us another control to investigate if a particular gag needs a specific final pose [3].

The published base price is US$0.40 for a five-second 768p clip, before reference-token overages. Four initial clips therefore have a US$1.60 base video-generation cost, excluding images, repairs, review, rendering, and other services [3].

This combination makes H3 a sensible first implementation candidate. It does not establish superior cartoon motion, identity consistency, or end-to-end completion time.

### What could change this choice

Kling 4.0 (`kling/v4/reference-to-video`) is the main quality challenger. It supports character/object elements, keyframes, and shot controls. Its current image-reference base price is US$0.785 for a five-second 720p clip [4]. Test whether its actual output improves recognizable faces, physical comedy, and the fraction of usable clips enough to justify the higher base cost.

Vidu Q4 (`fal-ai/vidu/q4/reference-to-video`) is a secondary cost challenger. Its published five-second 720p price is US$0.3325. However, the retrieved reference endpoint does not expose the same explicit starting-frame parameter as H3; reference guidance is not the same input contract as a prescribed first frame [5]. That tradeoff needs testing before replacing H3.

Choose a production default from observed results. Do not infer quality from feature count, reference limits, model version numbers, or promotional claims. A shared seed does not guarantee that a face stays consistent.

## 3. Gemma 4 for character descriptions

Initial model ID: `@cf/google/gemma-4-26b-a4b-it`  
Provider: Cloudflare Workers AI  
Used for: per-character “Choose for me” and filling all empty descriptions

### Why this was our initial decision

The task is short creative text generation: provide funny personality and performance directions within a selected holiday preset. It does not need an autonomous agent, a long reasoning process, or access to uploaded photos.

Cloudflare currently recommends this model for smaller-model workloads. Its published rates are US$0.10 per million input tokens and US$0.30 per million output tokens [6, 7]. This supports a low-cost initial choice for short, bounded responses, although latency and actual token use still need measurement.

Generate concise descriptions mapped to the requested character IDs; validate the response and preserve edited text. User-written descriptions can proceed without an additional LLM call. Names and photos are unnecessary for random description generation.

### What could change this choice

Switch to another currently supported low-cost Workers AI text model if it produces more varied visual comedy, fewer malformed responses, or better latency at similar or lower cost. Compare the small task we actually need, rather than selecting from general reasoning leaderboards.

Check deprecation notices before launch. In particular, Cloudflare has announced retirement of Llama 3.2 1B and 3B on November 20, 2026; those are unsuitable new defaults for this holiday launch [7]. That announcement should not be confused with the separate Llama 3.2 11B Vision model.

## 4. Gemma 4 for advisory visual review

Initial model ID: `@cf/google/gemma-4-26b-a4b-it`  
Provider: Cloudflare Workers AI  
Used for: limited checks of generated starting images and sampled clip frames

### Why this was our initial decision

Gemma has documented vision support [6]. Reusing it for visual questions allows the first implementation to share model configuration and integration work with the description service. These remain separate inference calls with separate token use and spending controls.

The earlier PRD named Llama 3.2 11B Vision. We revised the initial choice to Gemma for operational simplicity. We have not measured superior review accuracy, lower per-image cost, or lower latency. The replacement is an architectural starting decision, not a demonstrated quality improvement.

The review is advisory and narrow: obvious missing/extra people, severe face occlusion, or a clear switch away from the intended 2D style. It cannot certify likeness or judge whether a gag is funny. It must not treat intentional squash and stretch as a defect. Deterministic file, duration, decoding, and resolution checks remain separate.

### What could change this choice

Moondream 3.1 (`@cf/moondream/moondream3.1-9B-A2B`) is the specialist comparison candidate. Its documented interface includes visual queries, detection, pointing, and structured output [8]. Test it if character counting or other visual checks are unreliable with Gemma.

Calibrate any reviewer against human-labeled examples before its judgments trigger paid repairs. Measure false rejections of good cartoons as well as missed defects. Keep `uncertain` distinct from `clear_failure`. If a model cannot distinguish them usefully, retain hard technical checks and disable its repair-triggering role until improved; do not spend indefinitely trying to satisfy a subjective judge.

## 5. MediaPipe and BlazeFace Short-Range

Initial model asset: `blaze_face_short_range.tflite`, served through a pinned MediaPipe Tasks Vision setup  
Runs in: the user's browser  
Used for: locating the face in each required individual portrait and assisting crop framing

### Why this was our initial decision

Google documents a browser Face Detector integration using BlazeFace Short-Range and provides face locations and landmarks [9]. Our input requirement is a clear individual portrait, making a local face-location tool an appropriate starting point.

There is no need to send photos to an LLM simply to locate a face. This avoids an additional paid inference request and supports immediate framing feedback. Use ordinary image processing for source dimensions and blur heuristics.

### What could change this choice

Test supported mobile browsers and varied permissioned portraits. Replace the detector if missed faces, false multiple-face detections, bundle/runtime overhead, or browser compatibility materially harm the upload experience. Prefer an alternative that preserves local processing when practical.

Face detection is not face recognition or a guarantee that a source is sufficient for recognizable animation. Keep the documented manual-framing fallback for browser runtime failures. A future decision to accept difficult profiles or distant faces would require reevaluating the detector and the product's photo-quality rules together.

## 6. How to revisit these decisions

1. Start with a small permissioned set of individual portraits, descriptions, and fixed gags. Include solo and two-person scenes and varied appearances.
2. Compare image candidates on matched inputs and comparable output sizes. Compare video candidates on the same accepted character references and scene targets, adapting only model-specific input syntax where necessary.
3. Have people familiar with the subjects judge recognition. Rate style consistency, readable comedy, and motion separately from recognition.
4. Record full attempt cost, time including queueing, failure/retry rate, and cost per accepted output. A cheaper request can be more expensive if most results are unusable.
5. For visual reviewers, use human labels and measure false positives before enabling automatic paid recovery. Sampled-frame checks cannot establish correctness throughout an entire clip.
6. Pick one default per role after the comparison. Revisit it when evidence shows a meaningful quality, cost, latency, availability, or compatibility improvement.

Keep model IDs in server configuration and calls behind typed provider interfaces. Save the model ID, prompt/style version, relevant parameters, and selection date with each attempt. If a replacement has a different first-frame, duration, output-size, or reference contract, adapt and validate the pipeline rather than changing only a model-name string.

Update this document with the previous choice, new choice, evidence, and any tradeoff. Product scope changes remain separate from model substitutions. These decisions do not add user-visible model selection, extra customization steps, or scene retry controls.

## Sources and evidence boundaries

Provider pages establish exposed capabilities and published prices. They do not establish which model is best for this project's particular faces, cartoon style, or jokes. Recheck schemas, access, pricing, and deprecation notices during implementation.

1. [GPT Image 2.6 Flare Edit API](https://fal.ai/models/openai/gpt-image-2.6/flare/edit/api) and [pricing page](https://fal.ai/models/openai/gpt-image-2.6/flare/edit).
2. [Nano Banana 2.1 Edit API](https://fal.ai/models/google/nano-banana-2.1/edit/api) and [fal's measured settings/cost examples](https://fal.ai/learn/tools/how-to-use-nano-banana-2-1).
3. [H3 Max Reference-to-Video API](https://fal.ai/models/minimax/h3-max/reference-to-video/api) and [published pricing](https://fal.ai/models/minimax/h3-max/reference-to-video).
4. [Kling 4.0 Reference-to-Video API](https://fal.ai/models/kling/v4/reference-to-video/api) and [published pricing](https://fal.ai/models/kling/v4/reference-to-video).
5. [Vidu Q4 Reference-to-Video API](https://fal.ai/models/fal-ai/vidu/q4/reference-to-video/api) and [published pricing](https://fal.ai/models/fal-ai/vidu/q4/reference-to-video).
6. [Gemma 4 on Workers AI](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/).
7. [Cloudflare Workers AI changelog and model deprecation notice](https://developers.cloudflare.com/changelog/product/workers-ai/).
8. [Moondream 3.1 on Workers AI](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/).
9. [MediaPipe Face Detector](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector?tab=Web).
