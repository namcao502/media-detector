'use client'

import { useState } from 'react'
import type { DownloadProgressLine } from '@/types/media'
import { formatBytes, formatSpeed, formatDuration, parentDir } from '@/lib/format'
import { useIdleSeconds } from '@/hooks/useIdleSeconds'
import StatusIcon from './StatusIcon'

// yt-dlp emits a progress line roughly every 100ms while bytes are moving, so
// a longer gap than this means the transfer (or a postprocessor) is not talking.
const STALL_AFTER_SECONDS = 5

interface DownloadProgressProps {
  percent: number
  savedPath: string | null
  detail?: DownloadProgressLine | null
  phaseLabel?: string | null
  error?: string | null
  cancelled?: boolean
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
  cancelled = false,
  lastUpdateAt = null,
  active = false,
}: DownloadProgressProps) {
  const idleSeconds = useIdleSeconds(lastUpdateAt, active)
  const stalled = active && idleSeconds >= STALL_AFTER_SECONDS
  const [openError, setOpenError] = useState<string | null>(null)

  async function handleOpenFolder() {
    if (!savedPath) return
    setOpenError(null)
    try {
      const res = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: parentDir(savedPath) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setOpenError(
          typeof body.error === 'string' ? body.error : 'Could not open the folder',
        )
      }
    } catch {
      setOpenError('Could not open the folder')
    }
  }

  // Finished: the bar has nothing left to say, so it gives way to the verified
  // row. Stays until the format is downloaded again (FormatRow resets it).
  if (savedPath) {
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <StatusIcon kind="check" size={16} label="Download complete" />
          <span
            className="min-w-0 flex-1 truncate text-xs"
            style={{ color: 'var(--text-secondary)' }}
            title={savedPath}
          >
            Saved to {parentDir(savedPath)}
          </span>
          <button
            onClick={handleOpenFolder}
            className="flex-shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
            style={{
              background: 'var(--bg-fill)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            Open Folder
          </button>
        </div>
        {openError && (
          <div className="text-xs" style={{ color: 'var(--text-status-error-title)' }}>
            {openError}
          </div>
        )}
      </div>
    )
  }

  // yt-dlp leaves a resumable .part file behind rather than deleting the bytes
  // already fetched, so say so instead of implying nothing was written.
  if (cancelled) {
    return (
      <div className="mt-3 flex items-start gap-2">
        <span className="mt-0.5">
          <StatusIcon kind="warn" size={16} label="Download cancelled" />
        </span>
        <span className="min-w-0 flex-1 text-xs" style={{ color: 'var(--text-status-warn)' }}>
          Cancelled -- a partial file may remain in the folder
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-3 flex items-start gap-2">
        <span className="mt-0.5">
          <StatusIcon kind="error" size={16} label="Download failed" />
        </span>
        <span className="min-w-0 flex-1 text-xs" style={{ color: 'var(--text-status-error-title)' }}>
          {error}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-1.5">
      <div
        className="flex items-center justify-between text-xs font-medium"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span>{phaseLabel ?? 'Starting'}</span>
        <span className="tabular-nums">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={phaseLabel ?? 'Download progress'}
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--bg-fill)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, background: 'var(--accent)' }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
        <span className="min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
          {detail ? detailText(detail) : ''}
        </span>
        {stalled && (
          <span className="flex-shrink-0" style={{ color: 'var(--text-status-warn)' }}>
            no update for {idleSeconds}s
          </span>
        )}
      </div>
    </div>
  )
}
