'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { StatusResult } from '@/types/media'
import LogPanel from './LogPanel'
import StatusIcon from './StatusIcon'

interface StatusBarProps {
  status: StatusResult | null
  onRefresh: () => void
}

type RowState = 'ok' | 'error' | 'warn'

interface DepRowData {
  label: string
  state: RowState
  message: string
  // Compact form for the collapsed summary line, e.g. "Python 3.12.2".
  summary: string
  action: ReactNode
}

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
    decoder.decode(value, { stream: true }).split('\n').filter(Boolean).forEach(onLine)
  }
}

const PILL_BASE =
  'rounded-full px-4 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 active:opacity-70 disabled:opacity-50'

function PrimaryPill({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`${PILL_BASE} text-white`} style={{ background: 'var(--accent)' }}>
      {children}
    </button>
  )
}

function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={PILL_BASE}
      style={{
        background: 'var(--bg-fill)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </a>
  )
}

function DepRow({ label, state, message, action }: DepRowData) {
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
      ? { background: 'transparent' }
      : state === 'error'
        ? { background: 'var(--bg-status-error)' }
        : { background: 'var(--bg-status-warn)' }

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={rowStyle}>
      <StatusIcon kind={state === 'ok' ? 'check' : state} size={14} />
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// Builds the three dependency rows. Split out so the summary line and the
// expanded list are always derived from exactly the same data.
function buildRows(
  status: StatusResult,
  loading: boolean,
  install: (endpoint: string) => void,
): DepRowData[] {
  const python: DepRowData = status.python.found
    ? {
        label: 'Python',
        state: 'ok',
        message: `Version ${status.python.version} detected`,
        summary: `Python ${status.python.version}`,
        action: null,
      }
    : {
        label: 'Python',
        state: 'error',
        message: 'Not found -- install Python 3.8+ to continue',
        summary: 'Python missing',
        action: <SecondaryLink href="https://python.org/downloads">python.org &rarr;</SecondaryLink>,
      }

  let ytdlp: DepRowData
  if (!status.ytdlp.found) {
    ytdlp = {
      label: 'yt-dlp',
      state: 'error',
      message: 'Not installed -- required to detect and download media',
      summary: 'yt-dlp missing',
      action: status.python.found ? (
        <PrimaryPill onClick={() => install('/api/ytdlp/install')} disabled={loading}>
          {loading ? 'Installing...' : 'Install'}
        </PrimaryPill>
      ) : null,
    }
  } else if (status.ytdlp.updateStatus === 'failed') {
    ytdlp = {
      label: 'yt-dlp',
      state: 'warn',
      message: 'Update failed -- click Retry to try again',
      summary: `yt-dlp ${status.ytdlp.version} (update failed)`,
      action: (
        <PrimaryPill onClick={() => install('/api/ytdlp/update')} disabled={loading}>
          {loading ? 'Retrying...' : 'Retry'}
        </PrimaryPill>
      ),
    }
  } else {
    const suffix =
      status.ytdlp.updateStatus === 'updated' ? ' -- updated' :
      status.ytdlp.updateStatus === 'up-to-date' ? ' -- up to date' : ''
    ytdlp = {
      label: 'yt-dlp',
      state: 'ok',
      message: `Version ${status.ytdlp.version}${suffix}`,
      summary: `yt-dlp ${status.ytdlp.version}`,
      action: null,
    }
  }

  // ffmpeg is optional: downloads work without it, but metadata/thumbnails need it.
  const ffmpeg: DepRowData = status.ffmpeg.found
    ? {
        label: 'ffmpeg',
        state: 'ok',
        message: `Version ${status.ffmpeg.version} detected -- metadata & thumbnails embedded`,
        summary: `ffmpeg ${status.ffmpeg.version}`,
        action: null,
      }
    : {
        label: 'ffmpeg',
        state: 'warn',
        message: 'Not found -- install ffmpeg to embed metadata & cover art',
        summary: 'ffmpeg missing',
        action: (
          <div className="flex items-center gap-2">
            <PrimaryPill onClick={() => install('/api/ffmpeg/install')} disabled={loading}>
              {loading ? 'Installing...' : 'Install'}
            </PrimaryPill>
            <SecondaryLink href="https://ffmpeg.org/download.html">manual &rarr;</SecondaryLink>
          </div>
        ),
      }

  return [python, ytdlp, ffmpeg]
}

export default function StatusBar({ status, onRefresh }: StatusBarProps) {
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)
  const [expanded, setExpanded] = useState(false)

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

  const cardStyle = { background: 'var(--bg-card)', borderColor: 'var(--border)' }

  if (!status) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={cardStyle}>
        <span
          className="h-3.5 w-3.5 flex-shrink-0 animate-pulse rounded-full"
          style={{ background: 'var(--text-muted)' }}
        />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Checking dependencies...
        </span>
      </div>
    )
  }

  const rows = buildRows(status, loading, handleInstall)
  const problems = rows.filter((r) => r.state !== 'ok')
  const healthy = problems.length === 0
  // Problems always stay open -- there is an action to take, so hiding it would
  // be the one case where collapsing costs the user something.
  const open = healthy ? expanded : true

  const headline = healthy
    ? 'Ready'
    : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}`

  const subline = rows.map((r) => r.summary).join(' . ')

  return (
    <div className="rounded-2xl border" style={cardStyle}>
      <div className="flex items-center gap-3 px-4 py-3">
        <StatusIcon
          kind={healthy ? 'check' : problems.some((p) => p.state === 'error') ? 'error' : 'warn'}
          size={16}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {headline}
          </div>
          <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
            {subline}
          </div>
        </div>
        <button
          onClick={onRefresh}
          className={PILL_BASE}
          style={{
            background: 'var(--bg-fill)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          Recheck
        </button>
        {healthy && (
          <button
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide dependency details' : 'Show dependency details'}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <Chevron open={expanded} />
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          {rows.map((row) => (
            <DepRow key={row.label} {...row} />
          ))}
        </div>
      )}

      {showLog && logLines.length > 0 && (
        <div className="px-4 pb-3">
          <LogPanel lines={logLines} visible={showLog} />
        </div>
      )}
    </div>
  )
}
