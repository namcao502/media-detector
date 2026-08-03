import type { AudioFormat } from '@/types/media'

// Containers iOS plays natively (Apple Music app, Files, library sync, AirPods,
// CarPlay). YouTube's highest-bitrate audio is Opus-in-webm, which iOS does NOT
// play in its stock apps -- so we steer single downloads toward these instead.
const APPLE_NATIVE_AUDIO_EXTS = new Set(['m4a', 'mp3', 'aac', 'mp4'])

export function isApplePlayable(ext: string): boolean {
  return APPLE_NATIVE_AUDIO_EXTS.has(ext.toLowerCase())
}

// Floats iPhone-playable formats (m4a/AAC) to the top while preserving the
// incoming bitrate order within each group. Returns a new array (no mutation).
export function sortAudioForApple(formats: AudioFormat[]): AudioFormat[] {
  const playable = formats.filter((f) => isApplePlayable(f.ext))
  const rest = formats.filter((f) => !isApplePlayable(f.ext))
  return [...playable, ...rest]
}
