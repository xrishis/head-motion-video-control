"""Create Stillpoint's original, silent 60-second local practice lesson.

Requirements: Python 3.10+, Pillow, and FFmpeg with libx264 support.
Install Pillow with `python -m pip install Pillow`. Supply --ffmpeg, put ffmpeg
on PATH, or install `imageio-ffmpeg` to use its bundled executable.

Example: python browser/scripts/generate_demo.py --ffmpeg /path/to/ffmpeg
No external images, video, camera recordings, or network requests are used.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1280, 720
FPS, DURATION = 15, 60
BACKGROUND = "#f1f3ef"
FOREST = "#214e45"
INK = "#193d36"
SAGE = "#bdcaba"
MUTED = "#536c64"
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "demo"

CHAPTERS = (
    (0, "Make space for\nfocused learning", "Settle into a comfortable position.\nThis silent practice lesson is yours to explore."),
    (10, "Enable your\nlearning assistant", "Choose Enable camera, or choose\nTry without a camera to practice."),
    (20, "Face forward\nand calibrate", "Look at the screen in your natural position.\nFollow the calibration prompt when you are ready."),
    (30, "Try a turn\nand pause", "Gently look away for a moment.\nThe ready assistant will pause your lesson."),
    (45, "Resume with\nconfidence", "Face the screen again, then choose Play.\nAutomatic resume is available in playback preferences."),
)


def find_font(supplied: str | None, bold: bool = False) -> str:
    if supplied:
        return supplied
    candidates = (
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu") / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
        Path("/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise SystemExit("No suitable font found. Supply --font and --bold-font with TTF paths.")


def find_ffmpeg(supplied: str | None) -> str:
    executable = supplied or os.environ.get("STILLPOINT_FFMPEG") or shutil.which("ffmpeg")
    if executable:
        return executable
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as error:
        raise SystemExit("FFmpeg not found. Install FFmpeg or imageio-ffmpeg, or supply --ffmpeg.") from error


def centered_lines(draw: ImageDraw.ImageDraw, text: str, center_x: int, top: int,
                   font: ImageFont.FreeTypeFont, fill: str, line_height: int) -> None:
    for index, line in enumerate(text.splitlines()):
        draw.text((center_x, top + index * line_height), line, font=font, fill=fill, anchor="mt")


def chapter_frame(index: int, normal_font: str, bold_font: str) -> Image.Image:
    frame = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(frame)
    draw.ellipse((-430, -220, 320, 550), fill=FOREST)
    draw.ellipse((1030, 58, 1190, 218), fill=SAGE)
    draw.ellipse((900, 480, 1670, 1250), fill="#d1dbcf")
    title_font = ImageFont.truetype(bold_font, 62)
    label_font = ImageFont.truetype(normal_font, 26)
    caption_font = ImageFont.truetype(normal_font, 25)
    _, heading, caption = CHAPTERS[index]
    centered_lines(draw, heading, 700, 249, title_font, INK, 72)
    draw.text((700, 418), "Demo lesson · 01:00", font=label_font, fill=MUTED, anchor="mt")
    centered_lines(draw, caption, 700, 536, caption_font, INK, 38)
    draw.text((70, 641), f"{index + 1:02d} / 05", font=label_font, fill=MUTED, anchor="mt")
    draw.rounded_rectangle((330, 655, 1185, 661), radius=3, fill="#dae2d8")
    return frame


def write_poster(output: Path) -> None:
    # Vector artwork keeps the idle poster crisp at every player size.
    (output / "poster.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-labelledby="title description">
  <title id="title">Make space for focused learning</title>
  <desc id="description">An original Stillpoint practice lesson poster with forest green and sage circles on a pale neutral background. Demo lesson, one minute.</desc>
  <rect width="1280" height="720" fill="#f1f3ef"/>
  <ellipse cx="-55" cy="165" rx="375" ry="385" fill="#214e45"/>
  <circle cx="1110" cy="138" r="80" fill="#bdcaba"/>
  <circle cx="1285" cy="865" r="385" fill="#d1dbcf"/>
  <g text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" fill="#193d36">
    <text x="700" y="309" font-size="62" font-weight="700">Make space for</text>
    <text x="700" y="381" font-size="62" font-weight="700">focused learning</text>
    <text x="700" y="447" font-size="26" fill="#536c64">Demo lesson · 01:00</text>
  </g>
</svg>
''', encoding="utf-8")


def generate(output: Path, ffmpeg: str, normal_font: str, bold_font: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    write_poster(output)
    chapters = [chapter_frame(index, normal_font, bold_font) for index in range(len(CHAPTERS))]
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{WIDTH}x{HEIGHT}",
        "-framerate", str(FPS), "-i", "pipe:0", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "25",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", str(DURATION),
        str(output / "lesson.mp4"),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None and process.stderr is not None
    try:
        for frame_index in range(FPS * DURATION):
            timestamp = frame_index / FPS
            chapter = max(index for index, item in enumerate(CHAPTERS) if timestamp >= item[0])
            frame = chapters[chapter].copy()
            draw = ImageDraw.Draw(frame)
            progress_end = 330 + round(855 * (frame_index + 1) / (FPS * DURATION))
            draw.rounded_rectangle((330, 655, max(336, progress_end), 661), radius=3, fill=FOREST)
            process.stdin.write(frame.tobytes())
    except BrokenPipeError as error:
        raise RuntimeError(process.stderr.read().decode(errors="replace")) from error
    finally:
        process.stdin.close()
    stderr = process.stderr.read().decode(errors="replace")
    if process.wait() != 0:
        raise RuntimeError(f"FFmpeg failed: {stderr}")
    print(f"Created {output / 'lesson.mp4'} ({DURATION}s, {WIDTH}x{HEIGHT}, {FPS} fps, H.264, silent)")
    print(f"Created {output / 'poster.svg'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--ffmpeg", help="Path to an FFmpeg executable with libx264")
    parser.add_argument("--font", help="Path to the regular TTF font")
    parser.add_argument("--bold-font", help="Path to the bold TTF font")
    args = parser.parse_args()
    generate(args.output.resolve(), find_ffmpeg(args.ffmpeg), find_font(args.font), find_font(args.bold_font, bold=True))
