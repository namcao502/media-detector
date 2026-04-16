'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { StatusResult } from '@/types/media'
import LogPanel from './LogPanel'

interface StatusBarProps {
  status: StatusResult | null
  onRefresh: () => void
}

type RowState = 'ok' | 'error' | 'warn'

async function streamToLines(
  url: string,
  method: string,
  onLine: (line: string) => void,
): Promise<void> {
  const res = await fetch(url, { method })
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    decoder.decode(value).split('\n').filter(Boolean).forEach(onLine)
  }
}

function DepRow({
  label,
  state,
  message,
  action,
}: {
  label: string
  state: RowState
  message: string
  action?: ReactNode
}) {
  const dotColor =
    state === 'ok'
      ? 'var(--status-ok)'
      : state === 'error'
        ? 'var(--status-error)'
        : 'var(--status-warn)'

  const titleColor =
    state === 'ok'
      ? 'var(--text-primary)'
      : state === 'error'
        ? 'var(--text-status-error-title)'
        : 'var(--text-status-warn-title)'

  const msgColor =
    state === 'ok'
      ? 'var(--text-secondary)'
      : state === 'error'
        ? 'var(--text-status-error)'
        : 'var(--text-status-warn)'

  const rowStyle =
    state === 'ok'
      ? { background: 'var(--bg-card)', borderColor: 'var(--border)' }
      : state === 'error'
        ? { background: 'var(--bg-status-error)', borderColor: 'var(--border-status-error)' }
        : { background: 'var(--bg-status-warn)', borderColor: 'var(--border-status-warn)' }

  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-3"
      style={rowStyle}
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ background: dotColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: titleColor }}>
          {label}
        </div>
        <div className="mt-0.5 text-xs" style={{ color: msgColor }}>
          {message}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

export default function StatusBar({ status, onRefresh }: StatusBarProps) {
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  async function handleInstall(endpoint: string) {
    setLoading(true)
    setLogLines([])
    setShowLog(true)
    try {
      await streamToLines(endpoint, 'POST', (line) =>
        setLogLines((prev) => [...prev, line]),
      )
      onRefresh()
    } catch {
      setLogLines((prev) => [...prev, 'Error: request failed'])
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return (
      <div className="flex flex-col gap-2">
        {(['Python', 'yt-dlp'] as const).map((name) => (
          <div
            key={name}
            className="flex items-center gap-3 rounded-lg border px-4 py-3"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
          >
            <span
              className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full"
              style={{ background: 'var(--text-muted)' }}
            />
            <div>
              <div
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {name}
              </div>
              <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                Checking...
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Python row
  let pythonState: RowState = 'ok'
  let pythonMessage = `Version ${status.python.version} detected`
  let pythonAction: ReactNode = null
  if (!status.python.found) {
    pythonState = 'error'
    pythonMessage = 'Not found -- install Python 3.8+ to continue'
    pythonAction = (
      <a
        href="https://python.org/downloads"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded px-3 py-1.5 text-xs font-semibold hover:opacity-80"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        python.org &rarr;
      </a>
    )
  }

  // yt-dlp row
  let ytdlpState: RowState = 'ok'
  let ytdlpMessage = `Version ${status.ytdlp.version}`
  if (status.ytdlp.updateStatus === 'updated') ytdlpMessage += ' -- updated'
  else if (status.ytdlp.updateStatus === 'up-to-date') ytdlpMessage += ' -- up to date'
  let ytdlpAction: ReactNode = null
  if (!status.ytdlp.found) {
    ytdlpState = 'error'
    ytdlpMessage = 'Not installed -- required to detect and download media'
    if (status.python.found) {
      ytdlpAction = (
        <button
          onClick={() => handleInstall('/api/ytdlp/install')}
          disabled={loading}
          className="rounded px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? 'Installing...' : 'Install'}
        </button>
      )
    }
  } else if (status.ytdlp.updateStatus === 'failed') {
    ytdlpState = 'warn'
    ytdlpMessage = 'Update failed -- click Retry to try again'
    ytdlpAction = (
      <button
        onClick={() => handleInstall('/api/ytdlp/update')}
        disabled={loading}
        className="rounded px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? 'Retrying...' : 'Retry'}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <DepRow label="Python" state={pythonState} message={pythonMessage} action={pythonAction} />
      <DepRow label="yt-dlp" state={ytdlpState} message={ytdlpMessage} action={ytdlpAction} />
      <LogPanel lines={logLines} visible={showLog} />
    </div>
  )
}
