import type { VideoFormat, AudioFormat } from '@/types/media'
import { isApplePlayable } from './audioCompat'

// Picks the format most people want, so one row in a long list can be badged
// "Best" instead of leaving the user to compare codecs. Pure -- no mutation,
// returns the chosen formatId or null when there is nothing to choose from.

// Highest resolution, breaking ties toward mp4 (plays everywhere) and then fps.
export function recommendedVideoId(formats: VideoFormat[]): string | null {
  if (formats.length === 0) return null

  const best = formats.reduce((winner, candidate) => {
    if (candidate.height !== winner.height) {
      return candidate.height > winner.height ? candidate : winner
    }
    const candidateIsMp4 = candidate.ext.toLowerCase() === 'mp4'
    const winnerIsMp4 = winner.ext.toLowerCase() === 'mp4'
    if (candidateIsMp4 !== winnerIsMp4) return candidateIsMp4 ? candidate : winner
    return (candidate.fps ?? 0) > (winner.fps ?? 0) ? candidate : winner
  })

  return best.formatId
}

// Highest bitrate among the containers an iPhone plays natively; only falls back
// to the overall highest bitrate when nothing Apple-playable is on offer.
export function recommendedAudioId(formats: AudioFormat[]): string | null {
  if (formats.length === 0) return null

  const playable = formats.filter((f) => isApplePlayable(f.ext))
  const pool = playable.length !== 0 ? playable : formats
  const best = pool.reduce((winner, candidate) =>
    (candidate.abr ?? 0) > (winner.abr ?? 0) ? candidate : winner,
  )

  return best.formatId
}
