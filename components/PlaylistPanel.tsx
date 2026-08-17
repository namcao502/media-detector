'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  PlaylistInfo,
  PlaylistTrack,
  PlaylistDownloadLine,
  DownloadProgressLine,
  PlaylistFormatMode,
  PlaylistAudioFormat,
  PlaylistVideoQuality,
} from '@/types/media'
import { formatBytes, formatSpeed, formatDuration } from '@/lib/format'
import { downloadStem, rawStem } from '@/lib/filename'
import { useIdleSeconds } from '@/hooks/useIdleSeconds'
import StatusIcon from './StatusIcon'
import type { StatusIconKind } from './StatusIcon'

interface PlaylistPanelProps {
  info: PlaylistInfo
  url: string
  outputDir: string
  ffmpegReady: boolean
  cleanNames?: boolean
  onToggleCleanNames?: () => void
}

const AUDIO_OPTIONS: { value: PlaylistAudioFormat; label: string; needsFfmpeg: boolean }[] = [
  { value: 'm4a', label: 'M4A (iPhone)', needsFfmpeg: false },
  { value: 'mp3', label: 'MP3', needsFfmpeg: true },
  { value: 'best', label: 'Best (no conversion)', needsFfmpeg: false },
]

const VIDEO_OPTIONS: { value: PlaylistVideoQuality; label: string }[] = [
  { value: 'best', label: 'Best quality' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
]

interface Summary {
  folder: string
  downloaded: number
  total: number
  failed: number
  cancelled: boolean
}

const STALL_AFTER_SECONDS = 5

// Above this many tracks the list scrolls in place instead of pushing the
// progress bar and summary off the bottom of the page.
const LIST_MAX_HEIGHT = '18rem'

// "12.3 MB / 45.6 MB . 2.1 MB/s . ETA 0:14" for the track being downloaded.
function detailText(detail: DownloadProgressLine): string {
  return [
    `${formatBytes(detail.downloadedBytes)} / ${formatBytes(detail.totalBytes)}`,
    formatSpeed(detail.speedBytesPerSec),
    `ETA ${formatDuration(detail.etaSeconds)}`,
  ].join(' . ')
}

function ProgressBar({
  percent,
  label,
  thin = false,
}: {
  percent: number
  label: string
  thin?: boolean
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={`${thin ? 'h-1' : 'h-1.5'} w-full overflow-hidden rounded-full`}
      style={{ background: 'var(--bg-fill)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${percent}%`, background: 'var(--accent)' }}
      />
    </div>
  )
}

export default function PlaylistPanel({
  info,
  url,
  outputDir,
  ffmpegReady,
  cleanNames = true,
  onToggleCleanNames,
}: PlaylistPanelProps) {
  const [downloading, setDownloading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [total, setTotal] = useState(info.count)
  const [percent, setPercent] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [errored, setErrored] = useState<Set<number>>(new Set())
  const [retry, setRetry] = useState<Record<number, { attempt: number; phase: number }>>({})
  const [summary, setSummary] = useState<Summary | null>(null)
  const [detail, setDetail] = useState<DownloadProgressLine | null>(null)
  const [phaseLabel, setPhaseLabel] = useState<string | null>(null)
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null)
  const [mode, setMode] = useState<PlaylistFormatMode>('audio')
  const [audioFormat, setAudioFormat] = useState<PlaylistAudioFormat>('m4a')
  const [videoQuality, setVideoQuality] = useState<PlaylistVideoQuality>('1080')
  const [openError, setOpenError] = useState<string | null>(null)
  const [showOriginalTitles, setShowOriginalTitles] = useState(false)
  // Per-track filename overrides, keyed by track index.
  const [customNames, setCustomNames] = useState<Record<number, string>>({})
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const currentRowRef = useRef<HTMLLIElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Keep the track being worked on visible inside the scrolling list.
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentIndex])

  function handleCancel() {
    abortRef.current?.abort()
  }

  async function handleDownloadAll() {
    const controller = new AbortController()
    abortRef.current = controller
    setDownloading(true)
    setCurrentIndex(null)
    setPercent(0)
    setDone(new Set())
    setErrored(new Set())
    setRetry({})
    setSummary(null)
    setDetail(null)
    setPhaseLabel(null)
    setOpenError(null)
    setLastUpdateAt(Date.now())

    // Tracked locally: the `done`/`total` state read inside this closure is the
    // snapshot from the render that created it, so it never sees its own updates.
    let completed = 0
    let seenTotal = info.count

    try {
      const res = await fetch('/api/playlist/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url, outputDir, mode, audioFormat, videoQuality, cleanNames,
          names: customNames,
        }),
        signal: controller.signal,
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        setLastUpdateAt(Date.now())
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as PlaylistDownloadLine
            if (msg.type === 'item') { seenTotal = msg.total; setCurrentIndex(msg.index); setTotal(msg.total); setPercent(0); setDetail(null) }
            else if (msg.type === 'progress') { setPercent(msg.percent); setDetail(msg) }
            // Outside the download phase there are no byte counters to show, and
            // leaving the last ones up would suggest a transfer that has stopped.
            else if (msg.type === 'phase') { setPhaseLabel(msg.label); if (msg.phase !== 'downloading') setDetail(null) }
            else if (msg.type === 'track-retry') setRetry((prev) => ({ ...prev, [msg.index]: { attempt: msg.attempt, phase: msg.phase } }))
            else if (msg.type === 'track-skipped') setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next })
            else if (msg.type === 'track-done') { completed += 1; setDone((prev) => new Set(prev).add(msg.index)); setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next }) }
            else if (msg.type === 'track-error') { setErrored((prev) => new Set(prev).add(msg.index)); setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next }) }
            else if (msg.type === 'done') setSummary({ folder: msg.folder, downloaded: msg.downloaded, total: msg.total, failed: msg.failed, cancelled: msg.cancelled === true })
            else if (msg.type === 'error') setSummary((prev) => prev ?? { folder: '', downloaded: completed, total: seenTotal, failed: seenTotal - completed, cancelled: false })
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      // An aborted fetch is the user pressing Cancel: keep whatever finished and
      // report it as stopped rather than failed. The server kills yt-dlp itself.
      if (err instanceof DOMException && err.name === 'AbortError') {
        setSummary((prev) => prev ?? {
          folder: '',
          downloaded: completed,
          total: seenTotal,
          failed: 0,
          cancelled: true,
        })
      }
    } finally {
      abortRef.current = null
      setDownloading(false)
    }
  }

  async function handleOpenFolder() {
    if (!summary?.folder) return
    setOpenError(null)
    try {
      const res = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: summary.folder }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setOpenError(typeof body.error === 'string' ? body.error : 'Could not open the folder')
      }
    } catch {
      setOpenError('Could not open the folder')
    }
  }

  // Built from the same fields the server uses, so the preview and the file on
  // disk agree. A name typed here wins over both.
  function generatedName(track: PlaylistTrack): string {
    const source = { title: track.title, uploader: track.author }
    return cleanNames ? downloadStem(source) : rawStem(source)
  }

  function displayTitle(track: PlaylistTrack): string {
    const custom = customNames[track.index]
    if (custom !== undefined) return custom
    if (showOriginalTitles) return track.title
    return generatedName(track)
  }

  function startEditing(track: PlaylistTrack) {
    setDraft(displayTitle(track))
    setEditingIndex(track.index)
  }

  function commitEdit(track: PlaylistTrack) {
    const trimmed = draft.trim()
    setCustomNames((prev) => {
      const next = { ...prev }
      if (trimmed === '' || trimmed === generatedName(track)) delete next[track.index]
      else next[track.index] = trimmed
      return next
    })
    setEditingIndex(null)
  }

  const anyTitleChanged = info.tracks.some((t) => generatedName(t) !== t.title)
  const overallPercent = total > 0 ? Math.round(((done.size + errored.size) / total) * 100) : 0
  const idleSeconds = useIdleSeconds(lastUpdateAt, downloading)
  const stalled = downloading && idleSeconds >= STALL_AFTER_SECONDS
  const setupVisible = !downloading && !summary

  interface TrackStatus {
    icon: StatusIconKind
    iconLabel: string
    note: string
    noteColor: string
    isCurrent: boolean
  }

  function trackStatus(index: number): TrackStatus {
    if (done.has(index)) {
      return { icon: 'check', iconLabel: 'Downloaded', note: '', noteColor: '', isCurrent: false }
    }
    if (errored.has(index)) {
      return {
        icon: 'error',
        iconLabel: 'Failed',
        note: 'failed',
        noteColor: 'var(--text-status-error-title)',
        isCurrent: false,
      }
    }
    const r = retry[index]
    if (r) {
      return {
        icon: 'warn',
        iconLabel: 'Retrying',
        note: `retry ${r.attempt}/5`,
        noteColor: 'var(--text-status-warn)',
        isCurrent: currentIndex === index,
      }
    }
    if (currentIndex === index) {
      return { icon: 'active', iconLabel: 'Downloading', note: '', noteColor: '', isCurrent: true }
    }
    return { icon: 'idle', iconLabel: 'Pending', note: '', noteColor: '', isCurrent: false }
  }

  return (
    <div
      className="rounded-2xl border px-4 py-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {info.title}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {info.count} tracks
          </div>
        </div>
        {setupVisible && (
          <button
            onClick={handleDownloadAll}
            className="flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:opacity-70"
            style={{ background: 'var(--accent)' }}
          >
            {mode === 'video' ? 'Download all video' : 'Download all audio'}
          </button>
        )}
        {downloading && (
          <button
            onClick={handleCancel}
            className="flex-shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
            style={{
              background: 'var(--bg-fill)',
              color: 'var(--text-status-error)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {setupVisible && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--bg-fill)' }}>
            {(['audio', 'video'] as const).map((m) => {
              const disabled = m === 'video' && !ffmpegReady
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={disabled}
                  aria-pressed={mode === m}
                  className="flex-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition-colors disabled:opacity-40"
                  style={
                    mode === m
                      ? { color: 'var(--text-primary)', background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-pill)' }
                      : { color: 'var(--text-secondary)', background: 'transparent' }
                  }
                >
                  {m}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--text-muted)' }} htmlFor="playlist-format">
              Format
            </label>
            {mode === 'audio' ? (
              <select
                id="playlist-format"
                value={audioFormat}
                onChange={(e) => setAudioFormat(e.target.value as PlaylistAudioFormat)}
                className="flex-1 rounded-xl px-3 py-2 text-xs"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                {AUDIO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.needsFfmpeg && !ffmpegReady}>
                    {o.label}{o.needsFfmpeg && !ffmpegReady ? ' (needs ffmpeg)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="playlist-format"
                value={videoQuality}
                onChange={(e) => setVideoQuality(e.target.value as PlaylistVideoQuality)}
                className="flex-1 rounded-xl px-3 py-2 text-xs"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                {VIDEO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>

          {onToggleCleanNames && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>File names</span>
              <button
                onClick={onToggleCleanNames}
                aria-pressed={cleanNames}
                className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
                style={
                  cleanNames
                    ? { background: 'var(--accent)', color: '#ffffff', border: '1px solid transparent' }
                    : { background: 'var(--bg-fill)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
                }
              >
                {cleanNames ? 'Cleaned' : 'Original'}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                {cleanNames ? 'title - artist, tags removed' : 'yt-dlp default'}
              </span>
            </div>
          )}

          {!ffmpegReady && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              MP3 and video need ffmpeg.
            </div>
          )}
        </div>
      )}

      {(downloading || summary) && (
        <div className="mt-3 space-y-1.5">
          <div
            className="flex items-center justify-between text-xs font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>
              {summary
                ? summary.cancelled ? 'Cancelled' : 'Complete'
                : `Track ${currentIndex ?? 0} of ${total}`}
            </span>
            <span className="tabular-nums">{overallPercent}%</span>
          </div>
          <ProgressBar percent={overallPercent} label="Playlist progress" />
          {downloading && !summary && (
            <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
              <span className="min-w-0 truncate" style={{ color: 'var(--text-muted)' }}>
                {detail ? detailText(detail) : (phaseLabel ?? 'Starting')}
              </span>
              {stalled && (
                <span className="flex-shrink-0" style={{ color: 'var(--text-status-warn)' }}>
                  no update for {idleSeconds}s
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* The per-track author is only known once each video is fetched, so the
          list previews the cleaned title and the artist is appended at download. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {downloading ? 'File names' : 'Click a name to rename it'}
        </span>
        {cleanNames && anyTitleChanged && (
          <button
            onClick={() => setShowOriginalTitles((prev) => !prev)}
            aria-pressed={showOriginalTitles}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            {showOriginalTitles ? 'Show cleaned names' : 'Show original titles'}
          </button>
        )}
        {Object.keys(customNames).length > 0 && (
          <button
            onClick={() => setCustomNames({})}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            Reset {Object.keys(customNames).length} renamed
          </button>
        )}
      </div>

      <ul
        className="mt-2 space-y-1 overflow-y-auto pr-1"
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {info.tracks.map((t) => {
          const status = trackStatus(t.index)
          return (
            <li
              key={t.index}
              ref={status.isCurrent ? currentRowRef : null}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
              style={{
                color: 'var(--text-secondary)',
                background: status.isCurrent ? 'var(--bg-fill)' : 'transparent',
              }}
            >
              <StatusIcon kind={status.icon} size={14} label={status.iconLabel} />
              <span className="w-5 flex-shrink-0 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {t.index}
              </span>
              {editingIndex === t.index ? (
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  spellCheck={false}
                  aria-label={`File name for track ${t.index}`}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEdit(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(t)
                    if (e.key === 'Escape') setEditingIndex(null)
                  }}
                  className="min-w-0 flex-1 rounded-md px-2 py-0.5 text-xs"
                  style={{
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--accent)',
                  }}
                />
              ) : (
                <button
                  onClick={() => startEditing(t)}
                  disabled={downloading}
                  aria-label={`Rename track ${t.index}`}
                  title={`${t.title}\n\nClick to rename`}
                  className="min-w-0 flex-1 truncate text-left disabled:cursor-default"
                  style={{
                    color: customNames[t.index] !== undefined
                      ? 'var(--text-primary)'
                      : 'inherit',
                  }}
                >
                  {displayTitle(t)}
                </button>
              )}
              {status.isCurrent && !status.note && (
                <span className="w-24 flex-shrink-0">
                  <ProgressBar percent={percent} label={`Track ${t.index} progress`} thin />
                </span>
              )}
              {status.isCurrent && !status.note && (
                <span
                  className="w-9 flex-shrink-0 text-right tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {percent}%
                </span>
              )}
              {status.note && (
                <span className="flex-shrink-0" style={{ color: status.noteColor }}>
                  {status.note}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {summary && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <StatusIcon
                kind={summary.cancelled || summary.failed > 0 ? 'warn' : 'check'}
                size={16}
                label={
                  summary.cancelled
                    ? 'Stopped early'
                    : summary.failed > 0
                      ? 'Finished with failures'
                      : 'All tracks downloaded'
                }
              />
              <span
                style={{
                  color: summary.cancelled || summary.failed > 0
                    ? 'var(--text-status-warn)'
                    : 'var(--status-ok)',
                }}
              >
                Downloaded {summary.downloaded} of {summary.total}
                {summary.cancelled
                  ? ' -- stopped'
                  : summary.failed > 0 ? ` (${summary.failed} failed)` : ''}
              </span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              {summary.folder && (
                <button
                  onClick={handleOpenFolder}
                  className="rounded-full px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
                  style={{ background: 'var(--bg-fill)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                >
                  Open Folder
                </button>
              )}
              {/* Without this the summary would be a dead end -- the format picker
                  and Download button only return once the summary is cleared. */}
              <button
                onClick={() => setSummary(null)}
                className="rounded-full px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:opacity-70"
                style={{ background: 'var(--accent)' }}
              >
                {summary.cancelled ? 'Start again' : 'Download again'}
              </button>
            </span>
          </div>
          {openError && (
            <div className="text-xs" style={{ color: 'var(--text-status-error-title)' }}>
              {openError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
