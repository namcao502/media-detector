import type { MediaInfo } from '@/types/media'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatViews(n: number | null): string {
  if (!n) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`
  return `${n} views`
}

interface MediaInfoProps {
  info: MediaInfo
}

export default function MediaInfo({ info }: MediaInfoProps) {
  return (
    <div
      className="flex gap-4 rounded-lg border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      {info.thumbnail && (
        <img
          src={info.thumbnail}
          alt={info.title}
          className="h-20 w-36 flex-shrink-0 rounded object-cover"
        />
      )}
      <div className="flex flex-col justify-center">
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          {info.title}
        </h2>
        <div className="mt-1 flex gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>{info.channel}</span>
          <span>{formatDuration(info.duration)}</span>
          {info.viewCount && <span>{formatViews(info.viewCount)}</span>}
        </div>
      </div>
    </div>
  )
}
