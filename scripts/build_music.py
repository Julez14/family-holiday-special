"""Compose three original instrumental preset tracks, without external samples.

Run with Python 3. Output is private deployment material in .wrangler/music/.
The melodies and synthesized bell, bass and soft percussion parts are authored
for this project, rather than arrangements of existing Christmas songs.
"""
import array
import hashlib
import math
from pathlib import Path
import wave

RATE = 48000
SECONDS = 20
OUT = Path(__file__).resolve().parents[1] / '.wrangler' / 'music'
MELODIES = {
    'snowball': [72, 76, 79, 74, 77, 76, 72, 67, 74, 79, 77, 76, 69, 72, 74, 67,
                 76, 72, 81, 79, 77, 74, 76, 72, 67, 74, 71, 79, 76, 74, 72, 72],
    'giftwrap': [67, 72, 76, 72, 74, 69, 77, 76, 72, 79, 74, 71, 76, 74, 69, 67,
                72, 77, 76, 81, 79, 72, 74, 76, 69, 74, 77, 71, 74, 76, 72, 72],
    'danceoff': [72, 79, 76, 81, 79, 74, 77, 76, 69, 76, 72, 79, 74, 77, 71, 74,
                76, 81, 79, 72, 77, 74, 81, 79, 72, 76, 74, 67, 71, 79, 76, 72],
}


def compose(preset, melody):
    mix = array.array('d', [0.0]) * (RATE * SECONDS)

    def note(midi, start, duration, gain, bell=True):
        frequency = 440 * 2 ** ((midi - 69) / 12)
        for j in range(min(int(duration * RATE), len(mix) - int(start * RATE))):
            t = j / RATE
            attack = min(1.0, t / .008)
            if bell:
                sound = (math.sin(2 * math.pi * frequency * t) +
                         .25 * math.sin(2 * math.pi * frequency * 2.01 * t)) * math.exp(-4 * t)
            else:
                sound = math.sin(2 * math.pi * frequency * t) * math.exp(-6 * t)
            mix[int(start * RATE) + j] += gain * attack * sound

    for i, pitch in enumerate(melody):
        note(pitch, i * .5 + (.08 if preset == 'danceoff' and i % 2 else 0), 1.3, .15)
    roots = [48, 53, 45, 55, 48, 53, 55, 48]
    for bar, root in enumerate(roots):
        for beat in range(4):
            note(root if beat % 2 == 0 else root + 7, bar * 2 + beat * .5, .45, .18, False)
        for chord in (root + 12, root + 16, root + 19):
            note(chord, bar * 2 + .25, 1.6, .035)
    for pitch in (48, 60, 64, 67, 72):
        note(pitch, 16.0, 4, .10)
    pcm = array.array('h')
    peak = max(abs(value) for value in mix)
    for i, value in enumerate(mix):
        fade = min(1, i / (RATE * .04), (len(mix) - i) / (RATE * .35))
        sample = round(value / max(1.0, peak) * .8 * fade * 32767)
        pcm.extend((sample, sample))
    if __import__('sys').byteorder != 'little':
        pcm.byteswap()
    target = OUT / f'{preset}.wav'
    with wave.open(str(target), 'wb') as output:
        output.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())
    print(f'{preset}: 20s stereo PCM, sha256={hashlib.sha256(target.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for preset, melody in MELODIES.items():
        compose(preset, melody)
