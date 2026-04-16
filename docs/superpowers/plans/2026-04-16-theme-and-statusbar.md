# Theme & StatusBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded dark colors with CSS variables that respond to `prefers-color-scheme`, and redesign StatusBar to show one dependency per row with status dots and contextual messages.

**Architecture:** All color tokens are defined as CSS custom properties in `globals.css` under `:root` (light) and `@media (prefers-color-scheme: dark)`. Every component references these tokens via Tailwind arbitrary value syntax (`bg-[var(--bg-card)]`). No theme toggle -- follows OS preference automatically.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS v4, Jest, @testing-library/react

---

## File Map

| File | Change |
|------|--------|
| `app/globals.css` | Define all CSS color tokens for light + dark |
| `app/layout.tsx` | Swap hardcoded `bg-[#1a1a2e]` for `bg-[var(--bg-page)]` |
| `app/page.tsx` | Swap hardcoded error colors for token-based classes |
| `components/StatusBar.tsx` | Full redesign: 1 row per dep, dot + label + message + action |
| `components/LogPanel.tsx` | Swap hardcoded colors for tokens |
| `components/UrlInput.tsx` | Swap hardcoded colors for tokens |
| `components/MediaInfo.tsx` | Swap hardcoded colors for tokens |
| `components/FormatTabs.tsx` | Swap hardcoded colors for tokens |
| `components/FormatRow.tsx` | Swap hardcoded colors for tokens |
| `components/DownloadProgress.tsx` | Swap hardcoded colors for tokens |
| `components/__tests__/StatusBar.test.tsx` | Update tests for new StatusBar structure |

---

## Task 1: Define CSS color tokens

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace globals.css with token definitions**

Replace the entire contents of `app/globals.css` with:

```css
@import "tailwindcss";

/* Light mode tokens (default) */
:root {
  --bg-page:   #f1f5f9;
  --bg-card:   #ffffff;
  --bg-input:  #ffffff;
  --border:    #e2e8f0;

  --text-primary:   #0f172a;
  --text-secondary: #64748b;
  --text-muted:     #94a3b8;

  --accent:       #e94560;
  --accent-hover: #d63651;

  --bg-badge:   #dbeafe;
  --text-badge: #2563eb;

  --status-ok:   #16a34a;
  --status-error: #ef4444;
  --status-warn:  #f97316;

  --bg-status-error:     #fef2f2;
  --border-status-error: #fecaca;
  --text-status-error-title: #991b1b;
  --text-status-error:       #dc2626;

  --bg-status-warn:     #fff7ed;
  --border-status-warn: #fed7aa;
  --text-status-warn-title: #9a3412;
  --text-status-warn:       #ea580c;

  --log-bg:   rgba(0, 0, 0, 0.05);
  --log-text: #16a34a;
}

/* Dark mode tokens */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page:  #1a1a2e;
    --bg-card:  #1e2a45;
    --bg-input: #0f3460;
    --border:   #1e3a5f;

    --text-primary:   #e2e8f0;
    --text-secondary: #64748b;
    --text-muted:     #475569;

    --accent:       #e94560;
    --accent-hover: #d63651;

    --bg-badge:   #0f3460;
    --text-badge: #93c5fd;

    --status-ok:    #4ade80;
    --status-error: #f87171;
    --status-warn:  #fb923c;

    --bg-status-error:     #2d1a1a;
    --border-status-error: #7f1d1d;
    --text-status-error-title: #fca5a5;
    --text-status-error:       #f87171;

    --bg-status-warn:     #2a1f0a;
    --border-status-warn: #78350f;
    --text-status-warn-title: #fdba74;
    --text-status-warn:       #fb923c;

    --log-bg:   rgba(0, 0, 0, 0.4);
    --log-text: #4ade80;
  }
}

body {
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: Arial, Helvetica, sans-serif;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: define CSS color tokens for light/dark theme"
```

---

## Task 2: Update layout and page

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Update `app/layout.tsx`**

Replace the body className line:

```typescript
// Before
<body className={`${inter.className} min-h-screen bg-[#1a1a2e] text-gray-100`}>

// After
<body className={`${inter.className} min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]`}>
```

- [ ] **Step 2: Update error div in `app/page.tsx`**

Replace the error display block:

```typescript
// Before
{error && (
  <div className="rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-300">
    {error}
  </div>
)}

// After
{error && (
  <div
    className="rounded-lg border px-4 py-3 text-sm"
    style={{
      background: 'var(--bg-status-error)',
      borderColor: 'var(--border-status-error)',
      color: 'var(--text-status-error)',
    }}
  >
    {error}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx app/page.tsx
git commit -m "feat: apply theme tokens to layout and page error display"
```

---

## Task 3: Redesign StatusBar

**Files:**
- Modify: `components/StatusBar.tsx`
- Modify: `components/__tests__/StatusBar.test.tsx`

- [ ] **Step 1: Update the StatusBar tests**

Replace the entire contents of `components/__tests__/StatusBar.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StatusBar from '../StatusBar'
import type { StatusResult } from '@/types/media'

const allGood: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'up-to-date' },
}

const noPython: StatusResult = {
  python: { found: false, version: null },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
}

const noYtdlp: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
}

const ytdlpUpdateFailed: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'failed' },
}

describe('StatusBar', () => {
  it('shows a row per dependency with version when all OK', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expect(screen.getByText('Python')).toBeInTheDocument()
    expect(screen.getByText(/Version 3.12.2 detected/)).toBeInTheDocument()
    expect(screen.getByText('yt-dlp')).toBeInTheDocument()
    expect(screen.getByText(/2025.04.15/)).toBeInTheDocument()
  })

  it('shows loading rows when status is null', () => {
    render(<StatusBar status={null} onRefresh={jest.fn()} />)
    expect(screen.getAllByText('Checking...')).toHaveLength(2)
  })

  it('shows python.org link when Python is missing', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /python\.org/i })).toBeInTheDocument()
  })

  it('shows Install button when yt-dlp is missing and Python is present', () => {
    render(<StatusBar status={noYtdlp} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Not installed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
  })

  it('shows Retry button when yt-dlp update failed', () => {
    render(<StatusBar status={ytdlpUpdateFailed} onRefresh={jest.fn()} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onRefresh after install stream completes', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
        }),
      },
    } as unknown as Response)

    const onRefresh = jest.fn()
    render(<StatusBar status={noYtdlp} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest components/__tests__/StatusBar.test.tsx --no-coverage
```

Expected: FAIL -- "Version 3.12.2 detected" not found, "Checking..." assertions fail, etc.

- [ ] **Step 3: Implement the new `components/StatusBar.tsx`**

Replace the entire file:

```typescript
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
        python.org →
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
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest components/__tests__/StatusBar.test.tsx --no-coverage
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/StatusBar.tsx components/__tests__/StatusBar.test.tsx
git commit -m "feat: redesign StatusBar with per-dependency rows and theme tokens"
```

---

## Task 4: Update UrlInput and LogPanel

**Files:**
- Modify: `components/UrlInput.tsx`
- Modify: `components/LogPanel.tsx`

- [ ] **Step 1: Update `components/UrlInput.tsx`**

Replace the `input` and `button` className values:

```typescript
'use client'

import { useState } from 'react'

interface UrlInputProps {
  onDetect: (url: string) => void
  disabled: boolean
  loading: boolean
}

export default function UrlInput({ onDetect, disabled, loading }: UrlInputProps) {
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (value.trim()) onDetect(value.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste a YouTube or YouTube Music URL..."
        disabled={disabled || loading}
        className="flex-1 rounded-lg px-4 py-3 text-sm outline-none disabled:opacity-50"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      />
      <button
        type="submit"
        disabled={disabled || loading || !value.trim()}
        className="rounded-lg px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? 'Detecting...' : 'Detect'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Update `components/LogPanel.tsx`**

Replace the inner div className:

```typescript
'use client'

interface LogPanelProps {
  lines: string[]
  visible: boolean
}

export default function LogPanel({ lines, visible }: LogPanelProps) {
  if (!visible || lines.length === 0) return null
  return (
    <div
      className="mt-2 max-h-32 overflow-y-auto rounded px-3 py-2 font-mono text-xs"
      style={{ background: 'var(--log-bg)', color: 'var(--log-text)' }}
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Run UrlInput tests to confirm they still pass**

```bash
npx jest components/__tests__/UrlInput.test.tsx --no-coverage
```

Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/UrlInput.tsx components/LogPanel.tsx
git commit -m "feat: apply theme tokens to UrlInput and LogPanel"
```

---

## Task 5: Update MediaInfo and FormatTabs

**Files:**
- Modify: `components/MediaInfo.tsx`
- Modify: `components/FormatTabs.tsx`

- [ ] **Step 1: Update `components/MediaInfo.tsx`**

Replace the entire file:

```typescript
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
```

- [ ] **Step 2: Update `components/FormatTabs.tsx`**

Replace the entire file:

```typescript
'use client'

import { useState } from 'react'
import type { MediaInfo } from '@/types/media'
import FormatRow from './FormatRow'

interface FormatTabsProps {
  info: MediaInfo
  url: string
  onDownloadStart?: (formatId: string, ext: string) => void
}

export default function FormatTabs({ info, url, onDownloadStart }: FormatTabsProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')

  return (
    <div>
      <div
        className="mb-4 flex border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 text-xs font-bold uppercase tracking-wide transition-colors"
            style={
              activeTab === tab
                ? {
                    color: 'var(--text-primary)',
                    borderBottom: '2px solid var(--accent)',
                    marginBottom: '-1px',
                  }
                : {
                    color: 'var(--text-muted)',
                  }
            }
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {activeTab === 'video' &&
          info.videoFormats.map((f) => (
            <FormatRow
              key={f.formatId}
              type="video"
              format={f}
              url={url}
              title={info.title}
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
        {activeTab === 'audio' &&
          info.audioFormats.map((f) => (
            <FormatRow
              key={f.formatId}
              type="audio"
              format={f}
              url={url}
              title={info.title}
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/MediaInfo.tsx components/FormatTabs.tsx
git commit -m "feat: apply theme tokens to MediaInfo and FormatTabs"
```

---

## Task 6: Update FormatRow and DownloadProgress

**Files:**
- Modify: `components/FormatRow.tsx`
- Modify: `components/DownloadProgress.tsx`

- [ ] **Step 1: Update `components/FormatRow.tsx`**

Replace the entire file:

```typescript
'use client'

import { useState } from 'react'
import type { VideoFormat, AudioFormat, DownloadStreamLine } from '@/types/media'
import DownloadProgress from './DownloadProgress'

type FormatRowProps =
  | { type: 'video'; format: VideoFormat; url: string; title: string; onDownloadStart: (formatId: string, ext: string) => void }
  | { type: 'audio'; format: AudioFormat; url: string; title: string; onDownloadStart: (formatId: string, ext: string) => void }

function formatFilesize(bytes: number | null): string {
  if (bytes === null) return 'unknown size'
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1e6
  return `${mb.toFixed(0)} MB`
}

export default function FormatRow({ type, format, url, title, onDownloadStart }: FormatRowProps) {
  const [percent, setPercent] = useState<number | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const label =
    type === 'video'
      ? `${(format as VideoFormat).height}p`
      : `${(format as AudioFormat).abr ?? '?'}kbps`

  const codec =
    type === 'video'
      ? (format as VideoFormat).vcodec
      : (format as AudioFormat).acodec

  async function handleDownload() {
    setDownloading(true)
    setPercent(0)
    setSavedPath(null)
    onDownloadStart(format.formatId, format.ext)

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formatId: format.formatId, title, ext: format.ext }),
      })

      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as DownloadStreamLine
            if (parsed.type === 'progress') setPercent(parsed.percent)
            if (parsed.type === 'done') { setSavedPath(parsed.savedPath); setPercent(100) }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="rounded px-2 py-0.5 text-xs font-bold"
            style={{ background: 'var(--bg-badge)', color: 'var(--text-badge)' }}
          >
            {label}
          </span>
          <div>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {format.ext.toUpperCase()}
            </span>
            <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {codec}
            </span>
            {type === 'video' && (format as VideoFormat).fps && (
              <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {(format as VideoFormat).fps}fps
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatFilesize(format.filesize)}
          </span>
          {!downloading && !savedPath && (
            <button
              onClick={handleDownload}
              className="rounded px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              style={{ background: 'var(--accent)' }}
            >
              Download
            </button>
          )}
        </div>
      </div>
      {(percent !== null || savedPath) && (
        <DownloadProgress percent={percent ?? 0} savedPath={savedPath} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `components/DownloadProgress.tsx`**

Replace the entire file:

```typescript
'use client'

interface DownloadProgressProps {
  percent: number
  savedPath: string | null
}

export default function DownloadProgress({ percent, savedPath }: DownloadProgressProps) {
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
              className="rounded px-2 py-0.5 text-xs hover:opacity-80"
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run FormatRow and DownloadProgress tests**

```bash
npx jest components/__tests__/FormatRow.test.tsx components/__tests__/DownloadProgress.test.tsx --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/FormatRow.tsx components/DownloadProgress.tsx
git commit -m "feat: apply theme tokens to FormatRow and DownloadProgress"
```

---

## Task 7: Full test suite and typecheck

- [ ] **Step 1: Run all tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass across both node and jsdom projects. Fix any failures before proceeding.

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit if any fixes were made**

```bash
git add -A
git commit -m "fix: resolve any test or type issues from full suite run"
```
