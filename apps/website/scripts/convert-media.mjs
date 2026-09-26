// Encodes a recorded clip, a directory of numbered PNG frames written by
// scripts/record-media, into public/media/<name>.{mp4,webm} plus a WebP
// poster. The page offers WebM first and MP4 as the fallback; the poster
// is what shows before playback and, under prefers-reduced-motion,
// instead of it. Run through record-media and commit the output — see
// apps/website/README.md for why this isn't a build-time step.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1024;
const outDir = fileURLToPath(new URL('../public/media', import.meta.url));

function ffmpeg(args) {
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    {
      stdio: 'inherit',
    }
  );
}

/**
 * @param {{ frames: string, name: string, fps: number, poster: number }} clip
 *   `poster` is the 1-based number of the frame to use as the still.
 */
export function encodeClip({ frames, name, fps, poster }) {
  mkdirSync(outDir, { recursive: true });
  const input = ['-framerate', String(fps), '-i', join(frames, '%05d.png')];
  // Recorded at the demo's 1280x800 window and shown at about 600 CSS
  // pixels wide, so 1024 stays sharp on a 2x screen for far fewer bytes.
  const scale = ['-vf', `scale=${WIDTH}:-2:flags=lanczos`];

  // H.264 for broad support.
  ffmpeg([
    ...input,
    ...scale,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '32',
    '-preset',
    'veryslow',
    '-tune',
    'animation',
    '-an',
    '-movflags',
    '+faststart',
    join(outDir, `${name}.mp4`),
  ]);

  // VP9/WebM, the smaller source browsers pick first.
  ffmpeg([
    ...input,
    ...scale,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '46',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-an',
    join(outDir, `${name}.webm`),
  ]);

  ffmpeg([
    '-i',
    join(frames, `${String(poster).padStart(5, '0')}.png`),
    ...scale,
    '-c:v',
    'libwebp',
    '-quality',
    '80',
    join(outDir, `${name}-poster.webp`),
  ]);
}
