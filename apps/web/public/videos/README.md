# Giza Moment — video assets

`GizaMoment.tsx` renders a real cinematic video loop from these files.

| File | Purpose | Size |
| --- | --- | --- |
| `giza-dusk.webm` | Primary source (VP9, tried first by the `<video>` element) | ~4.3 MB |
| `giza-dusk.mp4` | Fallback source (H.264, `faststart`) | ~7.2 MB |
| `giza-dusk-poster.webp` | Poster frame shown before playback / on reduced motion / on `Save-Data` | ~65 KB |

## Provenance

The original production master (`giza-dusk.mp4`, ~68MB, iPhone 14 Pro H.264 export,
1920x1080, 30fps, 30.5s, no audio) was re-encoded locally with ffmpeg:

```
# MP4 (H.264, faststart)
ffmpeg -i giza-dusk-master.mp4 \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -an \
  -movflags +faststart giza-dusk.mp4

# WebM (VP9, constant quality)
ffmpeg -i giza-dusk-master.mp4 \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -pix_fmt yuv420p -an \
  -deadline good -cpu-used 2 -row-mt 1 giza-dusk.webm

# Poster (frame at 15s)
ffmpeg -ss 15 -i giza-dusk-master.mp4 -frames:v 1 -c:v libwebp -q:v 82 giza-dusk-poster.webp
```

Resolution/framerate/duration were kept as delivered (already ≤1080p); no audio
track was present to strip. Visual quality was spot-checked by comparing exported
frames from the master against both re-encodes before replacing the production
files — no visible banding, blocking, or softness at normal viewing size.

If the footage is ever replaced, re-run the same three commands against the new
master and drop the outputs in here — no code changes are needed as long as the
filenames stay the same.
