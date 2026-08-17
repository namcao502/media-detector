'use client'

import type { DownloadProgressLine } from '@/types/media'
import { formatBytes, formatSpeed, formatDuration } from '@/lib/format'
import { useIdleSeconds } from '@/hooks/useIdleSeconds'

// yt-dlp emits a progress line roughly every 100ms while bytes are moving, so
// a longer gap than this means the transfer (or a postprocessor) is not talking.
const STALL_AFTER_SECONDS = 5

interface DownloadProgressProps {
  percent: number
  savedPath: string | null
  detail?: DownloadProgressLine | null
  phaseLabel?: string | null
  error?: string | null
  // Timestamp of the last line received from the stream; drives the stall hint.
  lastUpdateAt?: number | null
  active?: boolean
}

// "12.3 MB / 45.6 MB . 2.1 MB/s . ETA 0:14", plus the fragment counter when the
// source is fragmented (DASH/HLS), where it is the clearest sign of movement.
function detailText(detail: DownloadProgressLine): string {
  const parts = [
    `${formatBytes(detail.downloadedBytes)} / ${formatBytes(detail.totalBytes)}`,
    formatSpeed(detail.speedBytesPerSec),
    `ETA ${formatDuration(detail.etaSeconds)}`,
  ]
  if (detail.fragmentCount !== undefined && detail.fragmentCount > 1) {
    parts.push(`frag ${detail.fragmentIndex ?? 0}/${detail.fragmentCount}`)
  }
  return parts.join(' . ')
}

export default function DownloadProgress({
  percent,
  savedPath,
  detail = null,
  phaseLabel = null,
  error = null,
  lastUpdateAt = null,
  active = false,
}: DownloadProgressProps) {
  const idleSeconds = useIdleSeconds(lastUpdateAt, active)
  const stalled = active && idleSeconds >= STALL_AFTER_SECONDS

  async function handleOpenFolder() {
    if (!savedPath) return
    const dir = savedPath.split(/[\\/]/).slice(0, -1).join('\\')
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    })
  }

  return (
    <div className="mt-2 space-y-1">
      {(phaseLabel || active) && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span>{phaseLabel ?? 'Starting'}</span>
          {stalled && (
            <span style={{ color: 'var(--text-status-warn)' }}>
              no update for {idleSeconds}s
            </span>
          )}
        </div>
      )}

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--border)' }}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${percent}%`, background: 'var(--accent)' }}
        />
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{percent}%</span>
        {savedPath && (
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--status-ok)' }}>Saved to Documents\MediaDetector</span>
            <button
              onClick={handleOpenFolder}
              className="rounded-full px-3 py-0.5 text-xs transition-opacity hover:opacity-80 active:opacity-60"
              style={{
                background: 'var(--bg-fill)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Open Folder
            </button>
          </div>
        )}
      </div>

      {detail && !savedPath && (
        <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {detailText(detail)}
        </div>
      )}

      {error && (
        <div className="text-xs" style={{ color: 'var(--text-status-error-title)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
