import type { ExportSettings } from '@/types/export';

const CODEC_REVERSE_MAP: Record<string, ExportSettings['codec']> = {
  avc: 'h264',
  hevc: 'h265',
  vp8: 'vp8',
  vp9: 'vp9',
};

const ALLOWED_FPS = [24, 25, 30, 50, 60, 120, 240] as const;

export function reverseMapCodec(codec: string): ExportSettings['codec'] {
  return CODEC_REVERSE_MAP[codec] ?? 'h264';
}

export function roundToNearestAllowedFps(fps: number): number {
  let nearest = ALLOWED_FPS[0];
  let minDiff = Math.abs(fps - nearest);
  for (const allowed of ALLOWED_FPS) {
    const diff = Math.abs(fps - allowed);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = allowed;
    }
  }
  return nearest;
}
