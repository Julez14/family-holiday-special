# Bundled asset provenance

| Asset | Origin and use |
| --- | --- |
| `public/fixtures/*` | Original illustrations/animations constructed by `scripts/build_fixtures.py` for this repository. No real people's photographs, model generations or third-party music. Source remains editable and reproducible. These prove software behavior, not likeness or model quality. |
| Fixture audio | Silent development AAC bed, generated locally. |
| Audio-contract test tones | Programmatic 440 Hz unwanted clip audio and 880 Hz selected test bed, created only in temporary test directories. |
| DM Sans / Fraunces | Self-hosted Fontsource variable font files, SIL Open Font License. Copies in `docs/licenses/`. |
| MediaPipe Tasks Vision | npm package pinned to `1.2.2` in package.json/lockfile. WASM/runtime copied locally at install time, not committed. Preserve the package's upstream notices. |
| BlazeFace Short-Range model | Version `float16/1`, downloaded from Google's MediaPipe model repository. SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`. Install script verifies this exact file. |
| Icons | Lucide React dependency under its upstream ISC license. |
| Production music and representative samples | Not supplied. The code-drawn fixtures are not production likeness samples. |

Detector source: [Google model asset](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite), [MediaPipe model integration documentation](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector?tab=Web). Face location is local photo-quality assistance, not identity recognition.

Native renderer dependencies are installed from the pinned Python requirement and Debian image; development FFmpeg/ffprobe packages remain development dependencies. Preserve applicable upstream notices when distributing binaries or container images.
