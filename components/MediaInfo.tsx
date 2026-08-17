import type { MediaInfo } from '@/types/media'
import { formatDuration } from '@/lib/format'

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
      className="flex gap-4 rounded-2xl border p-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      {info.thumbnail && (
        <img
          src={info.thumbnail}
          alt=""
          className="h-20 w-36 flex-shrink-0 rounded-xl object-cover"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h2
          className="line-clamp-2 font-semibold"
          style={{ color: 'var(--text-primary)' }}
          title={info.title}
        >
          {info.title}
        </h2>
        <div
          className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="truncate">{info.channel}</span>
          <span className="tabular-nums">{formatDuration(info.duration)}</span>
          {info.viewCount && <span className="tabular-nums">{formatViews(info.viewCount)}</span>}
        </div>
      </div>
    </div>
  )
}
