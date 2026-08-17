'use client'

import { useRef, useState } from 'react'
import type { VideoFormat, AudioFormat, DownloadStreamLine, DownloadProgressLine } from '@/types/media'
import { isApplePlayable } from '@/lib/audioCompat'
import { formatBytes } from '@/lib/format'
import DownloadProgress from './DownloadProgress'

interface FormatRowCommon {
  url: string
  title: string
  outputDir: string
  // Naming metadata, forwarded so the server can predict the saved path when
  // yt-dlp reports none (e.g. the file was already downloaded).
  artist?: string | null
  track?: string | null
  channel?: string | null
  cleanNames?: boolean
  // Filename stem typed by the user; wins over whatever the rules produce.
  customName?: string | null
  recommended?: boolean
  onDownloadStart: (formatId: string, ext: string) => void
}

type FormatRowProps =
  | ({ type: 'video'; format: VideoFormat } & FormatRowCommon)
  | ({ type: 'audio'; format: AudioFormat } & FormatRowCommon)

function formatFilesize(bytes: number | null): string {
  if (bytes === null) return 'unknown size'
  return formatBytes(bytes)
}

function Tag({
  children,
  background,
  color,
  border,
}: {
  children: React.ReactNode
  background: string
  color: string
  border?: string
}) {
  return (
    <span
      className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background, color, border }}
    >
      {children}
    </span>
  )
}

export default function FormatRow(props: FormatRowProps) {
  const {
    type, format, url, title, outputDir, recommended = false, onDownloadStart,
    artist = null, track = null, channel = null, cleanNames = true, customName = null,
  } = props
  const [percent, setPercent] = useState<number | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [detail, setDetail] = useState<DownloadProgressLine | null>(null)
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const label =
    props.type === 'video'
      ? `${props.format.height}p`
      : `${props.format.abr ?? '?'}kbps`

  const codec = props.type === 'video' ? props.format.vcodec : props.format.acodec

  function handleCancel() {
    abortRef.current?.abort()
  }

  async function handleDownload() {
    const controller = new AbortController()
    abortRef.current = controller
    setDownloading(true)
    setPercent(0)
    setSavedPath(null)
    setDetail(null)
    setPhaseLabel(null)
    setError(null)
    setCancelled(false)
    setLastUpdateAt(Date.now())
    onDownloadStart(format.formatId, format.ext)

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url, formatId: format.formatId, title, ext: format.ext, outputDir,
          artist, track, channel, cleanNames, filename: customName,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(typeof body.error === 'string' ? body.error : 'Download request rejected')
        return
      }
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setLastUpdateAt(Date.now())
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as DownloadStreamLine
            if (parsed.type === 'progress') { setPercent(parsed.percent); setDetail(parsed) }
            // Outside the download phase there are no byte counters to show, and
            // leaving the last ones up would suggest a transfer that has stopped.
            if (parsed.type === 'phase') {
              setPhaseLabel(parsed.label)
              if (parsed.phase !== 'downloading') setDetail(null)
            }
            if (parsed.type === 'error') { setError(parsed.message); setPhaseLabel(null) }
            if (parsed.type === 'done') { setSavedPath(parsed.savedPath); setPercent(100); setPhaseLabel(null) }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      // An aborted fetch is the user pressing Cancel, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') setCancelled(true)
      else setError('Network error. Is the server still running?')
    } finally {
      abortRef.current = null
      setDownloading(false)
    }
  }

  const showProgress = percent !== null || savedPath !== null || error !== null || cancelled

  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{
        background: 'var(--bg-card)',
        borderColor: recommended ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Tag background="var(--bg-badge)" color="var(--text-badge)">
            {label}
          </Tag>
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {format.ext.toUpperCase()}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {codec}
          </span>
          {props.type === 'video' && props.format.fps !== null && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {props.format.fps}fps
            </span>
          )}
          {recommended && (
            <Tag background="var(--accent)" color="#ffffff">
              Best
            </Tag>
          )}
          {props.type === 'audio' &&
            (isApplePlayable(props.format.ext) ? (
              <Tag background="transparent" color="var(--status-ok)" border="1px solid var(--status-ok)">
                iPhone
              </Tag>
            ) : (
              <Tag
                background="var(--bg-status-warn)"
                color="var(--text-status-warn)"
                border="1px solid var(--border-status-warn)"
              >
                Not on iPhone
              </Tag>
            ))}
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {formatFilesize(format.filesize)}
          </span>
          {downloading && (
            <button
              onClick={handleCancel}
              className="rounded-full px-4 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
              style={{
                background: 'var(--bg-fill)',
                color: 'var(--text-status-error)',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
          )}
          {!downloading && !savedPath && (
            <button
              onClick={handleDownload}
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:opacity-70"
              style={{ background: 'var(--accent)' }}
            >
              {error || cancelled ? 'Retry' : 'Download'}
            </button>
          )}
        </div>
      </div>

      {showProgress && (
        <DownloadProgress
          percent={percent ?? 0}
          savedPath={savedPath}
          detail={detail}
          phaseLabel={phaseLabel}
          error={error}
          cancelled={cancelled}
          lastUpdateAt={lastUpdateAt}
          active={downloading}
        />
      )}
    </div>
  )
}
