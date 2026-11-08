import { cp, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const destination = new URL('../public/vendor/vision/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), destination, { recursive: true });
const model = await readFile(new URL('../public/vendor/blaze_face_short_range.tflite', import.meta.url));
if (createHash('sha256').update(model).digest('hex') !== 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f') throw new Error('The pinned portrait detector model does not match its checksum.');
