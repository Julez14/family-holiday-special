"""The only production rendering path: four silent pictures, then one music bed."""
from __future__ import annotations
import base64
import io
import json
import math
import os
import platform
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

Image.MAX_IMAGE_PIXELS = 40_000_000
VERSION = 'ffmpeg-v1'
WIDTH, HEIGHT, FPS = 1280, 720, 24


def binary(name):
    configured = os.environ.get(name.upper() + '_BINARY')
    if configured:
        return configured
    system = 'darwin' if platform.system() == 'Darwin' else 'linux'
    machine = 'arm64' if platform.machine() in ('arm64','aarch64') else 'x64'
    local = Path(__file__).resolve().parents[1] / 'node_modules' / ('@ffmpeg-installer' if name == 'ffmpeg' else '@ffprobe-installer') / f'{system}-{machine}' / name
    return str(local) if local.exists() else name


def command(args: list[str], timeout=180):
    args = [binary(args[0]), *args[1:]]
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout).stdout


def probe(path: Path):
    return json.loads(command(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], 20))


def normalize(data: bytes, crop=None):
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 40_000_000:
            raise ValueError('Unsupported portrait dimensions or encoding')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Use a still portrait')
        source.load()  # enforce decoded limits, do not trust header dimensions alone
        image = ImageOps.exif_transpose(source).convert('RGB')
        if crop:
            x, y, w, h = [float(crop[k]) for k in ('x', 'y', 'width', 'height')]
            if not all(math.isfinite(v) for v in (x,y,w,h)) or min(x,y) < 0 or min(w,h) <= 0 or x+w > 1.001 or y+h > 1.001:
                raise ValueError('Invalid crop')
            image = image.crop((int(x*image.width), int(y*image.height), min(image.width, int((x+w)*image.width)), min(image.height, int((y+h)*image.height))))
        image.thumbnail((2400, 2400))
        output = io.BytesIO()
        image.save(output, 'JPEG', quality=93)  # no original EXIF, ICC, GPS or other metadata
        return output.getvalue(), image.size


def inspect(path: Path, video: bool):
    if not video:
        with Image.open(path) as image:
            image.load()
            if image.width * image.height > 40_000_000:
                raise ValueError('Oversize image')
            sample = image.convert('RGB'); sample.thumbnail((512, 512))
            b = io.BytesIO(); sample.save(b, 'JPEG', quality=75)
            return dict(width=image.width, height=image.height, samples=['data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()])
    metadata = probe(path)
    streams = [s for s in metadata['streams'] if s['codec_type'] == 'video']
    if len(streams) != 1:
        raise ValueError('Expected one video stream')
    stream = streams[0]
    duration = float(metadata['format']['duration'])
    if duration < 4.5 or not stream.get('width') or abs(stream['width']/stream['height'] - 16/9) > .05:
        raise ValueError('Clip duration or framing failed')
    command(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path), '-an', '-f', 'null', '-'], 100)
    samples = []
    for time in (.2, min(duration/2, 2.5), min(duration-.2, 4.3)):
        frame = command(['ffmpeg', '-v', 'error', '-ss', str(time), '-i', str(path), '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], 20)
        if not frame:
            raise ValueError('Frame extraction failed')
        samples.append('data:image/jpeg;base64,' + base64.b64encode(frame).decode())
    return dict(width=stream['width'], height=stream['height'], duration=duration, samples=samples)


def end_card(portraits: list[Path], destination: Path):
    if not 1 <= len(portraits) <= 6:
        raise ValueError('Expected 1–6 portraits')
    canvas = Image.new('RGB', (WIDTH, HEIGHT), '#f8f0dd')
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((22, 22, 1258, 698), radius=36, outline='#204c40', width=5)
    font_path = next((str(p) for p in [Path('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'), Path('/System/Library/Fonts/Supplemental/Georgia Bold.ttf')] if p.exists()), None)
    font = ImageFont.truetype(font_path, 58) if font_path else ImageFont.load_default(size=58)
    draw.text((WIDTH//2, 75), 'Happy Holidays!', font=font, fill='#a62e38', anchor='mt')
    n = len(portraits); columns = min(3, n); rows = math.ceil(n/columns)
    cell_width, cell_height = 1130//columns, 485//rows
    for i, path in enumerate(portraits):
        with Image.open(path) as original:
            figure = original.convert('RGBA')
            figure.thumbnail((cell_width - 24, cell_height - 15))
            row, col = divmod(i, columns)
            row_count = min(columns, n-row*columns)
            center_x = WIDTH//2 + (col - (row_count-1)/2)*cell_width
            x = round(center_x - figure.width/2)
            y = 172 + row*cell_height + cell_height - figure.height
            canvas.paste(figure, (x, y), figure)
    canvas.save(destination, 'PNG')


def render(clips: list[Path], portraits: list[Path], music: Path, destination: Path, workdir: Path):
    if len(clips) != 4:
        raise ValueError('Exactly four moving shots are required')
    parts = []
    for i, clip in enumerate(clips):
        inspect(clip, True)
        part = workdir / f'part-{i}.mp4'
        # Explicit -an and video-only mapping remove every generated source audio track.
        command(['ffmpeg', '-y', '-v', 'error', '-i', str(clip), '-map', '0:v:0', '-an', '-t', '4.5', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', str(part)])
        parts.append(part)
    card = workdir / 'end-card.png'; end_card(portraits, card)
    tail = workdir / 'end-card.mp4'
    command(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', str(card), '-an', '-t', '2', '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', str(tail)])
    parts.append(tail)
    listing = workdir / 'concat.txt'
    listing.write_text(''.join(f"file '{p.name}'\n" for p in parts))
    silent = workdir / 'picture.mp4'
    command(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', str(listing), '-map', '0:v:0', '-an', '-c:v', 'copy', str(silent)])
    # Only input 1's audio is mapped. Source speech, SFX and music cannot leak into the output.
    command(['ffmpeg', '-y', '-v', 'error', '-i', str(silent), '-stream_loop', '-1', '-i', str(music), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'afade=t=in:st=0:d=0.2,afade=t=out:st=19.4:d=0.6', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '20', '-movflags', '+faststart', str(destination)])
    verify_final(destination)
    return card


def verify_final(path: Path):
    p = probe(path)
    streams = p['streams']
    video = [s for s in streams if s['codec_type'] == 'video']
    audio = [s for s in streams if s['codec_type'] == 'audio']
    if len(video) != 1 or len(audio) != 1:
        raise ValueError('Final output must contain one video and one audio stream')
    v = video[0]
    if (v['width'], v['height'], v['codec_name'], v['pix_fmt'], v['r_frame_rate']) != (1280,720,'h264','yuv420p','24/1') or audio[0]['codec_name'] != 'aac' or abs(float(p['format']['duration'])-20) > .12:
        raise ValueError('Final media contract failed')
