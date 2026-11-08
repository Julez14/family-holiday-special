import { useEffect, useRef, useState } from 'react';
import { X, Crop as CropIcon } from 'lucide-react';
import type { Crop } from '../shared/contracts';
export interface CropRequest {
  preview: string;
  crop: Crop;
  manual: boolean;
  onComplete: (crop: Crop | null) => void;
}
export function CropDialog({ request }: { request: CropRequest }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [crop, setCrop] = useState(request.crop);
  const [confirmed, setConfirmed] = useState(!request.manual);
  useEffect(() => {
    dialog.current?.showModal();
    const el = dialog.current;
    const cancel = (e: Event) => {
      e.preventDefault();
      request.onComplete(null);
    };
    el?.addEventListener('cancel', cancel);
    return () => el?.removeEventListener('cancel', cancel);
  }, [request]);
  const change = (key: keyof Crop, value: number) =>
    setCrop((c) => {
      const next = { ...c, [key]: value };
      if (key === 'width') next.x = Math.min(next.x, 1 - value);
      if (key === 'height') next.y = Math.min(next.y, 1 - value);
      if (key === 'x') next.width = Math.min(next.width, 1 - value);
      if (key === 'y') next.height = Math.min(next.height, 1 - value);
      return next;
    });
  return (
    <dialog ref={dialog} className="crop-dialog" aria-labelledby="crop-title">
      <button
        className="icon-button dialog-close"
        aria-label="Cancel crop"
        onClick={() => request.onComplete(null)}
      >
        <X size={20} />
      </button>
      <div className="eyebrow">
        <CropIcon size={16} /> A little face time
      </div>
      <h2 id="crop-title">Keep the whole character.</h2>
      <p>Leave room for hair, glasses, and that unmistakable grin.</p>
      {request.manual && (
        <p className="notice">
          Face detection couldn’t run in this browser. Frame one clear face and confirm the photo
          yourself.
        </p>
      )}
      <div className="crop-image-wrap">
        <img src={request.preview} alt="Your individual portrait with an adjustable crop" />
        <div
          className="crop-box"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
          }}
        />
      </div>
      <div className="crop-sliders">
        {(
          [
            ['x', 'Left', 0, 0.95],
            ['y', 'Top', 0, 0.95],
            ['width', 'Width', 0.05, 1],
            ['height', 'Height', 0.05, 1],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <span>{Math.round(crop[key] * 100)}%</span>
            <input
              type="range"
              aria-label={`Crop ${label.toLowerCase()}`}
              min={min}
              max={max}
              step=".01"
              value={crop[key]}
              onChange={(e) => change(key, Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      {request.manual && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          This photo shows exactly one person with a clear face.
        </label>
      )}
      <button
        className="button primary full"
        disabled={!confirmed}
        onClick={() => request.onComplete(crop)}
      >
        Use this portrait <span>↗</span>
      </button>
    </dialog>
  );
}
