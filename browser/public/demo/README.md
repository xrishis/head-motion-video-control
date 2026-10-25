# Original Stillpoint practice lesson

`lesson.mp4` is a 60-second **silent** instructional practice clip generated for this project. It contains original geometric shapes, typography, chapter instructions, and a small progress bar. It includes no camera recordings, external footage, photographs, music, or spoken audio. A quiet clip lets the learner practice playback control without missing spoken content.

`poster.svg` is the matching original vector poster. The player provides its own play button and controls.

Both assets are created by [`../../scripts/generate_demo.py`](../../scripts/generate_demo.py) using Pillow and FFmpeg. The geometric composition follows this project's Stillpoint visual concept: a pale `#f1f3ef` backdrop, forest green artwork, sage accents, and the heading “Make space for focused learning.” The video is 1280 × 720 at 15 fps, H.264 with `yuv420p` pixels and MP4 fast-start metadata, for local browser playback without a network dependency.

| Time | Chapter |
| --- | --- |
| 00:00–00:10 | Welcome and settle into position |
| 00:10–00:20 | Enable the learning assistant or use the camera-free practice mode |
| 00:20–00:30 | Face forward and calibrate |
| 00:30–00:45 | Try a turn and pause |
| 00:45–01:00 | Resume with confidence |

To regenerate from the repository root:

```sh
python -m pip install Pillow imageio-ffmpeg
python browser/scripts/generate_demo.py
```

Alternatively, install Pillow alone and supply an existing FFmpeg executable with `--ffmpeg /path/to/ffmpeg`. The script uses Segoe UI on Windows, DejaVu Sans on Linux, or Arial on macOS. You can pass `--font` and `--bold-font` to select local TTF fonts. Font glyphs are rendered into the clip; font files are not distributed here.

The generator does not fetch media or contact a network service. Rebuilding with a different platform font may produce slightly different text metrics.
