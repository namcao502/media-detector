'use client'

import { useState } from 'react'
import type {
  PlaylistInfo,
  PlaylistDownloadLine,
  PlaylistFormatMode,
  PlaylistAudioFormat,
  PlaylistVideoQuality,
} from '@/types/media'

interface PlaylistPanelProps {
  info: PlaylistInfo
  url: string
  outputDir: string
  ffmpegReady: boolean
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
}

export default function PlaylistPanel({ info, url, outputDir, ffmpegReady }: PlaylistPanelProps) {
  const [downloading, setDownloading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [total, setTotal] = useState(info.count)
  const [percent, setPercent] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [errored, setErrored] = useState<Set<number>>(new Set())
  const [retry, setRetry] = useState<Record<number, { attempt: number; phase: number }>>({})
  const [summary, setSummary] = useState<Summary | null>(null)
  const [mode, setMode] = useState<PlaylistFormatMode>('audio')
  const [audioFormat, setAudioFormat] = useState<PlaylistAudioFormat>('m4a')
  const [videoQuality, setVideoQuality] = useState<PlaylistVideoQuality>('1080')

  async function handleDownloadAll() {
    setDownloading(true)
    setCurrentIndex(null)
    setPercent(0)
    setDone(new Set())
    setErrored(new Set())
    setRetry({})
    setSummary(null)

    try {
      const res = await fetch('/api/playlist/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, outputDir, mode, audioFormat, videoQuality }),
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as PlaylistDownloadLine
            if (msg.type === 'item') { setCurrentIndex(msg.index); setTotal(msg.total); setPercent(0) }
            else if (msg.type === 'progress') setPercent(msg.percent)
            else if (msg.type === 'track-retry') setRetry((prev) => ({ ...prev, [msg.index]: { attempt: msg.attempt, phase: msg.phase } }))
            else if (msg.type === 'track-skipped') setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next })
            else if (msg.type === 'track-done') { setDone((prev) => new Set(prev).add(msg.index)); setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next }) }
            else if (msg.type === 'track-error') { setErrored((prev) => new Set(prev).add(msg.index)); setRetry((prev) => { const next = { ...prev }; delete next[msg.index]; return next }) }
            else if (msg.type === 'done') setSummary({ folder: msg.folder, downloaded: msg.downloaded, total: msg.total, failed: msg.failed })
            else if (msg.type === 'error') setSummary((prev) => prev ?? { folder: '', downloaded: done.size, total, failed: total - done.size })
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      setDownloading(false)
    }
  }

  async function handleOpenFolder() {
    if (!summary?.folder) return
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: summary.folder }),
    })
  }

  const overallPercent = total > 0 ? Math.round(((done.size + errored.size) / total) * 100) : 0

  function trackStatus(index: number): { label: string; color: string } {
    if (done.has(index)) return { label: 'OK', color: 'var(--status-ok)' }
    if (errored.has(index)) return { label: 'ERR', color: 'var(--text-status-error-title)' }
    const r = retry[index]
    if (r) return { label: `${r.attempt}/5`, color: 'var(--text-status-warn)' }
    if (currentIndex === index) return { label: '>', color: 'var(--text-muted)' }
    return { label: '', color: 'var(--text-muted)' }
  }

  return (
    <div className="rounded-2xl border px-4 py-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{info.title}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{info.count} tracks</div>
        </div>
        {!downloading && !summary && (
          <button
            onClick={handleDownloadAll}
            className="rounded-full px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:opacity-70"
            style={{ background: 'var(--accent)' }}
          >
            {mode === 'video' ? 'Download all video' : 'Download all audio'}
          </button>
        )}
      </div>

      {!downloading && !summary && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: 'var(--bg-fill)' }}>
            {(['audio', 'video'] as const).map((m) => {
              const disabled = m === 'video' && !ffmpegReady
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={disabled}
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
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Format</span>
            {mode === 'audio' ? (
              <select
                value={audioFormat}
                onChange={(e) => setAudioFormat(e.target.value as PlaylistAudioFormat)}
                className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
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
                value={videoQuality}
                onChange={(e) => setVideoQuality(e.target.value as PlaylistVideoQuality)}
                className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                {VIDEO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>

          {!ffmpegReady && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              MP3 and video need ffmpeg.
            </div>
          )}
        </div>
      )}

      {(downloading || summary) && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{summary ? 'Complete' : `Track ${currentIndex ?? 0} of ${total}`}</span>
            <span>{overallPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
            <div className="h-full transition-all" style={{ width: `${overallPercent}%`, background: 'var(--accent)' }} />
          </div>
          {downloading && !summary && (
            <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
              <div className="h-full transition-all" style={{ width: `${percent}%`, background: 'var(--accent)' }} />
            </div>
          )}
        </div>
      )}

      <ul className="mt-3 space-y-1">
        {info.tracks.map((t) => {
          const status = trackStatus(t.index)
          return (
            <li key={t.index} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-semibold" style={{ width: '2.5rem', color: status.color }}>
                {status.label}
              </span>
              <span>{t.index}. {t.title}</span>
            </li>
          )
        })}
      </ul>

      {summary && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span style={{ color: 'var(--status-ok)' }}>
            Downloaded {summary.downloaded} of {summary.total}{summary.failed > 0 ? ` (${summary.failed} failed)` : ''}
          </span>
          {summary.folder && (
            <button
              onClick={handleOpenFolder}
              className="rounded-full px-3 py-0.5 text-xs transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--bg-fill)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              Open Folder
            </button>
          )}
        </div>
      )}
    </div>
  )
}
