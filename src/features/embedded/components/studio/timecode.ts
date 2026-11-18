/** HH:MM:SS:FF of a frame. */
export function timecode(frame: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps))
  const f = Math.max(0, Math.floor(frame))
  const seconds = Math.floor(f / rate)
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, f % rate]
  return parts.map((n) => String(n).padStart(2, '0')).join(':')
}
