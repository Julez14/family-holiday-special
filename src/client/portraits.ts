import type { Crop } from '../shared/contracts';
import { portraitQuality } from '../shared/policies';
let detector: Promise<import('@mediapipe/tasks-vision').FaceDetector> | undefined;
const getDetector = () =>
  (detector ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('/vendor/vision');
    return FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: '/vendor/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    });
  })());
export interface PreparedPortrait {
  blob: Blob;
  preview: string;
  crop: Crop;
  manual: boolean;
  warning?: string;
}
export async function preparePortrait(file: File): Promise<PreparedPortrait> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(
      'Use a JPEG, PNG or WebP photo. For HEIC, open it in Photos and export as JPEG first.',
    );
  if (file.size > 15 * 1024 * 1024)
    throw new Error('This photo is over 15 MiB. Choose a smaller individual portrait.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This photo couldn’t be opened. Try exporting it as JPEG.');
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('This photo is over 40 megapixels. Export a smaller version first.');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let crop: Crop = { x: 0.08, y: 0.03, width: 0.84, height: 0.94 };
    let manual = false;
    let warning: string | undefined;
    let detected: import('@mediapipe/tasks-vision').Detection[] | null = null;
    try {
      detected = (await getDetector()).detect(canvas).detections;
    } catch {
      manual = true;
    }
    if (detected) {
      const faces = detected.map((d) => {
        const b = d.boundingBox!;
        return {
          width: b.width / scale,
          height: b.height / scale,
          clipped:
            b.originX < 2 ||
            b.originY < 2 ||
            b.originX + b.width > canvas.width - 2 ||
            b.originY + b.height > canvas.height - 2,
        };
      });
      const result = portraitQuality(faces, blurScore(canvas));
      if (!result.usable) throw new Error(result.message);
      warning = result.message;
      const b = detected[0].boundingBox!;
      const x = Math.max(0, b.originX - b.width * 0.55) / canvas.width;
      const y = Math.max(0, b.originY - b.height * 0.75) / canvas.height;
      crop = {
        x,
        y,
        width: Math.min(1 - x, (b.width * 2.1) / canvas.width),
        height: Math.min(1 - y, (b.height * 2.4) / canvas.height),
      };
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Photo processing failed.'))),
        'image/jpeg',
        0.93,
      ),
    );
    return { blob, preview: URL.createObjectURL(blob), crop, manual, warning };
  } finally {
    bitmap.close();
  }
}
function blurScore(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, 160, 160);
  const data = ctx.getImageData(0, 0, 160, 160).data;
  const gray = (x: number, y: number) => {
    const i = (y * 160 + x) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  let sum = 0,
    squared = 0,
    n = 0;
  for (let y = 1; y < 159; y++)
    for (let x = 1; x < 159; x++) {
      const l = 4 * gray(x, y) - gray(x - 1, y) - gray(x + 1, y) - gray(x, y - 1) - gray(x, y + 1);
      sum += l;
      squared += l * l;
      n++;
    }
  return squared / n - (sum / n) ** 2;
}
