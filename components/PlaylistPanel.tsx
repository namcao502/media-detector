'use client'

import { useState } from 'react'
import type { PlaylistInfo, PlaylistDownloadLine } from '@/types/media'

interface PlaylistPanelProps {
  info: PlaylistInfo
  url: string
}

interface Summary {
  folder: string
  downloaded: number
  total: number
  failed: number
}

export default function PlaylistPanel({ info, url }: PlaylistPanelProps) {
  const [downloading, setDownloading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const [total, setTotal] = useState(info.count)
  const [percent, setPercent] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [summary, setSummary] = useState<Summary | null>(null)

  async function handleDownloadAll() {
    setDownloading(true)
    setCurrentIndex(null)
    setPercent(0)
    setDone(new Set())
    setSummary(null)

    try {
      const res = await fetch('/api/playlist/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
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
            else if (msg.type === 'track-done') setDone((prev) => new Set(prev).add(msg.index))
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

  const overallPercent = total > 0 ? Math.round((done.size / total) * 100) : 0

  return (
    <div className="rounded-lg border px-4 py-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{info.title}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{info.count} tracks</div>
        </div>
        {!downloading && !summary && (
          <button
            onClick={handleDownloadAll}
            className="rounded px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            Download all audio
          </button>
        )}
      </div>

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
        {info.tracks.map((t) => (
          <li key={t.index} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span style={{ width: '1.25rem', color: done.has(t.index) ? 'var(--status-ok)' : 'var(--text-muted)' }}>
              {done.has(t.index) ? 'OK' : currentIndex === t.index ? '>' : ''}
            </span>
            <span>{t.index}. {t.title}</span>
          </li>
        ))}
      </ul>

      {summary && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span style={{ color: 'var(--status-ok)' }}>
            Downloaded {summary.downloaded} of {summary.total}{summary.failed > 0 ? ` (${summary.failed} failed)` : ''}
          </span>
          {summary.folder && (
            <button
              onClick={handleOpenFolder}
              className="rounded px-2 py-0.5 text-xs hover:opacity-80"
              style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              Open Folder
            </button>
          )}
        </div>
      )}
    </div>
  )
}
