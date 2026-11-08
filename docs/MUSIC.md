# Production music register

The `dev` deployment uses three original instrumental compositions synthesized by [build_music.py](../scripts/build_music.py). Each is 20 seconds of stereo 48 kHz PCM. The melody, bell synthesis and bass parts are authored in this repository; there are no imported recordings, third-party samples, existing-song arrangements, lyrics or voices. The project can incorporate and redistribute these original tracks with its downloadable videos.

The committed development fixtures contain silent AAC audio. No generated clip audio is used in final rendering. The renderer test uses synthetic sine waves solely to prove audio isolation; these are not preset tracks.

| Preset / private R2 key | Track/source | License and proof | Downloadable-video redistribution rights | Status |
| --- | --- | --- | --- | --- |
| Snowball Showdown / `music/snowball.wav` | Original bell/bass composition; source above | Project-authored synthesis; no external inputs | Included in project outputs | Uploaded to private dev R2 |
| Gift-Wrap Disaster / `music/giftwrap.wav` | Original bell/bass composition; source above | Project-authored synthesis; no external inputs | Included in project outputs | Uploaded to private dev R2 |
| North Pole Dance-Off / `music/danceoff.wav` | Original bell/bass composition; source above | Project-authored synthesis; no external inputs | Included in project outputs | Uploaded to private dev R2 |

Run `npm run music` to recreate the private deployment files in ignored `.wrangler/music/`. Only `wrangler.dev.jsonc` enables these tracks. `main` retains silent mock fixtures; the undeployed production-real template remains disabled.

Uploaded WAV SHA-256 values (November 7, 2026):

```
snowball  7f88e64f0b7569ebda3e4ee1433fcf2e7d71b8758fcc724ec2c9a2db2ba2296d
giftwrap  53a5655ed5af8f31c50506b808e558faf9faed0e5d9b619f05092abf01b7775d
danceoff  92375d6f8199cd530aa6548f5b10a214fcd9dbe2f867b9e5c0f6471cedb9f928
```

The renderer strips all provider-generated clip audio, uses only the selected private preset track and applies short fades. Replacing these tracks with commercial music requires documenting the replacement's downloadable-video rights here.
