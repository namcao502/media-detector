# Playlist Audio Download Implementation Plan

> **For agentic workers:** Use s3-implement to execute this plan task-by-task.

**Ticket:** side project, manual git (feature slug `playlist-audio`)

**Frontend repo:** none -- this repo is the full app (Next.js UI + API routes)

**Goal:** Detect a YouTube/YouTube Music playlist URL and download every track as best-available audio (no re-encode) into a per-playlist folder.

**Expected outcome (acceptance criteria):**
- [ ] A pure playlist URL (`youtube.com/playlist?list=...`, `music.youtube.com/playlist?list=...`) shows the playlist title, track count, and the list of track titles, with a "Download all audio" button.
- [ ] A watch+list URL (`watch?v=X&list=Y`) shows BOTH the existing single-video format flow AND the playlist panel, so the user chooses which to grab.
- [ ] A plain watch URL (no `list=`) behaves exactly as today: no playlist panel, no extra network call.
- [ ] Clicking "Download all audio" downloads each track's best audio stream (`-f bestaudio/best`, no ffmpeg) into `Documents/MediaDetector/<playlist title>/`, named `NN - title.ext`.
- [ ] During download an overall "Track N of M" bar advances and the current track shows a `%` bar; completed tracks are marked done in the list.
- [ ] One unavailable/private track does not abort the batch (`--ignore-errors`); the final summary reports `downloaded / total` (+ failed count) with an Open Folder button.
- [ ] A `list=` value starting with `RD` (auto radio/mix) is NOT treated as a playlist.
- [ ] New lib functions have passing unit tests; `npx tsc --noEmit` is clean; existing detect/download routes are untouched.

**Architecture:** Two new API routes plus one component, layered on the existing patterns. `POST /api/playlist` returns playlist metadata via `yt-dlp --flat-playlist --dump-single-json` (fast, no per-video probing). `POST /api/playlist/download` runs a single `yt-dlp` process over the whole playlist and streams NDJSON progress; the stdout->events aggregation is a pure reducer in `lib/ytdlp.ts` so it is unit-testable without spawning yt-dlp. `app/page.tsx` inspects the URL with a new `getYouTubeUrlKind` helper and fires video and/or playlist detection in parallel. `PlaylistPanel` renders the track list, progress, and summary. No ffmpeg dependency.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, yt-dlp (spawned), Jest (node + jsdom projects).

---

## File Structure

New:
- `app/api/playlist/route.ts` -- POST: playlist metadata (flat dump)
- `app/api/playlist/download/route.ts` -- POST: streaming playlist audio download (NDJSON)
- `components/PlaylistPanel.tsx` -- playlist title + track list + progress + summary
- Tests: `app/api/playlist/__tests__/route.test.ts`, `app/api/playlist/download/__tests__/route.test.ts`, `components/__tests__/PlaylistPanel.test.tsx`

Modify:
- `types/media.ts` -- add `PlaylistTrack`, `PlaylistInfo`, playlist stream line types
- `lib/validate.ts` -- add `YouTubeUrlKind` + `getYouTubeUrlKind`
- `lib/ytdlp.ts` -- add `parsePlaylistInfo`, `parsePlaylistItem`, `reducePlaylistLine`, `finalizePlaylist`, `PlaylistDlState`, `initialPlaylistState`
- `lib/__tests__/validate.test.ts`, `lib/__tests__/ytdlp.test.ts` -- extend
- `app/page.tsx` -- detect playlist in parallel, render `PlaylistPanel`
- `AGENTS.md` -- document the new routes/component

---

## Task 1: Types

**Files:**
- Modify: `types/media.ts` (append after `DownloadStreamLine`)

No test of its own (types are exercised by later tasks). Just add:

- [ ] **Step 1: Add the types**
```ts
export interface PlaylistTrack {
  index: number // 1-based position in the playlist
  title: string
}

export interface PlaylistInfo {
  title: string
  count: number
  tracks: PlaylistTrack[]
}

export interface PlaylistItemLine {
  type: 'item'
  index: number
  total: number
}

export interface PlaylistTrackDoneLine {
  type: 'track-done'
  index: number
  savedPath: string
}

export interface PlaylistBatchDoneLine {
  type: 'done'
  folder: string
  downloaded: number
  total: number
  failed: number
}

// Reuses DownloadProgressLine ({type:'progress',percent}) for the current track
// and DownloadErrorLine ({type:'error',message}) for a fatal spawn error.
export type PlaylistDownloadLine =
  | DownloadProgressLine
  | PlaylistItemLine
  | PlaylistTrackDoneLine
  | PlaylistBatchDoneLine
  | DownloadErrorLine
```

- [ ] **Step 2: Typecheck**
Run: `npx tsc --noEmit`
Expected: PASS (no consumers yet).

---

## Task 2: URL kind helper

**Files:**
- Modify: `lib/validate.ts`
- Test: `lib/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the file)
```ts
import { isYouTubeUrl, extractYouTubeUrl, getYouTubeUrlKind } from '../validate'

describe('getYouTubeUrlKind', () => {
  it('pure playlist URL is playlist only', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/playlist?list=PL123'))
      .toEqual({ hasVideo: false, hasPlaylist: true })
  })
  it('watch+list URL is both', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc&list=PL123'))
      .toEqual({ hasVideo: true, hasPlaylist: true })
  })
  it('plain watch URL is video only', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('youtu.be short link is video only', () => {
    expect(getYouTubeUrlKind('https://youtu.be/abc'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('RD radio/mix list is not a playlist', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc&list=RD123'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('non-YouTube URL is neither', () => {
    expect(getYouTubeUrlKind('https://vimeo.com/1?list=PL1'))
      .toEqual({ hasVideo: false, hasPlaylist: false })
  })
})
```
(Update the existing top `import` line to include `getYouTubeUrlKind`.)

- [ ] **Step 2: Run -- expect FAIL**
Run: `npx jest lib/__tests__/validate.test.ts --no-coverage`
Expected: FAIL "getYouTubeUrlKind is not a function"

- [ ] **Step 3: Write minimal implementation** (append to `lib/validate.ts`)
```ts
export interface YouTubeUrlKind {
  hasVideo: boolean
  hasPlaylist: boolean
}

export function getYouTubeUrlKind(input: string): YouTubeUrlKind {
  try {
    const url = new URL(input.trim())
    if (!YOUTUBE_HOSTS.includes(url.hostname)) return { hasVideo: false, hasPlaylist: false }
    const list = url.searchParams.get('list')
    // ponytail: exclude RD* (auto-generated radio/mix) -- effectively endless, not a real playlist
    const hasPlaylist = !!list && !list.startsWith('RD')
    const isShortLink = url.hostname === 'youtu.be' && url.pathname.length > 1
    const hasVideo = !!url.searchParams.get('v') || isShortLink
    return { hasVideo, hasPlaylist }
  } catch {
    return { hasVideo: false, hasPlaylist: false }
  }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `npx jest lib/__tests__/validate.test.ts --no-coverage`
Expected: PASS

---

## Task 3: Playlist parsers + download reducer

**Files:**
- Modify: `lib/ytdlp.ts`
- Test: `lib/__tests__/ytdlp.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the file)
```ts
import {
  parsePlaylistItem, parsePlaylistInfo,
  reducePlaylistLine, finalizePlaylist, initialPlaylistState,
} from '../ytdlp'
import type { PlaylistDownloadLine, PlaylistBatchDoneLine } from '@/types/media'

describe('parsePlaylistItem', () => {
  it('parses "Downloading item N of M"', () => {
    expect(parsePlaylistItem('[download] Downloading item 3 of 10')).toEqual({ index: 3, total: 10 })
  })
  it('parses legacy "Downloading video N of M"', () => {
    expect(parsePlaylistItem('[download] Downloading video 1 of 5')).toEqual({ index: 1, total: 5 })
  })
  it('returns null for non-item lines', () => {
    expect(parsePlaylistItem('[download] 50% of 3MiB')).toBeNull()
  })
})

describe('parsePlaylistInfo', () => {
  it('extracts title, count, and indexed tracks', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [{ title: 'A' }, { title: 'B' }] })
    const info = parsePlaylistInfo(json)
    expect(info.title).toBe('Mix')
    expect(info.count).toBe(2)
    expect(info.tracks).toEqual([{ index: 1, title: 'A' }, { index: 2, title: 'B' }])
  })
  it('uses placeholder title for null/untitled entries', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [null, { title: 'B' }] })
    const info = parsePlaylistInfo(json)
    expect(info.tracks[0]).toEqual({ index: 1, title: 'Track 1' })
  })
})

describe('reducePlaylistLine + finalizePlaylist', () => {
  it('aggregates a two-track run into item/track-done/done events', () => {
    const lines = [
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\out\\Mix\\01 - A.m4a',
      '[download] 100% of 3MiB',
      '[download] Downloading item 2 of 2',
      '[download] Destination: C:\\out\\Mix\\02 - B.m4a',
      '[download] 100% of 3MiB',
    ]
    let state = initialPlaylistState
    const emits: PlaylistDownloadLine[] = []
    for (const line of lines) {
      const r = reducePlaylistLine(state, line)
      state = r.state
      emits.push(...r.emits)
    }
    emits.push(...finalizePlaylist(state, 'C:\\out'))

    expect(emits.filter((e) => e.type === 'item')).toHaveLength(2)
    expect(emits.filter((e) => e.type === 'track-done')).toHaveLength(2)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done.downloaded).toBe(2)
    expect(done.total).toBe(2)
    expect(done.failed).toBe(0)
    expect(done.folder).toContain('Mix')
  })

  it('counts a skipped track (no destination) as failed', () => {
    const lines = [
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\out\\Mix\\01 - A.m4a',
      '[download] 100% of 3MiB',
      '[download] Downloading item 2 of 2', // item 2 fails: no Destination follows
    ]
    let state = initialPlaylistState
    for (const line of lines) state = reducePlaylistLine(state, line).state
    const finals = finalizePlaylist(state, 'C:\\out')
    const done = finals.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done.downloaded).toBe(1)
    expect(done.total).toBe(2)
    expect(done.failed).toBe(1)
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `npx jest lib/__tests__/ytdlp.test.ts --no-coverage`
Expected: FAIL (functions not exported)

- [ ] **Step 3: Write minimal implementation** (append to `lib/ytdlp.ts`; add `PlaylistInfo, PlaylistDownloadLine` to the type import at the top)
```ts
export function parsePlaylistItem(line: string): { index: number; total: number } | null {
  const m = line.match(/Downloading (?:item|video) (\d+) of (\d+)/)
  if (!m) return null
  return { index: parseInt(m[1], 10), total: parseInt(m[2], 10) }
}

export function parsePlaylistInfo(jsonStr: string): PlaylistInfo {
  const raw = JSON.parse(jsonStr)
  const entries: Array<{ title?: string | null } | null> = raw.entries ?? []
  const tracks = entries.map((e, i) => ({ index: i + 1, title: e?.title ?? `Track ${i + 1}` }))
  return { title: raw.title ?? 'Playlist', count: tracks.length, tracks }
}

export interface PlaylistDlState {
  index: number | null // current track (1-based), null before first item
  total: number
  dest: string | null // destination path of current track, null until announced
  downloaded: number // tracks that completed with a destination
  lastFolder: string | null
}

export const initialPlaylistState: PlaylistDlState = {
  index: null, total: 0, dest: null, downloaded: 0, lastFolder: null,
}

// Pure reducer: fold one yt-dlp output line into state + emitted stream lines.
export function reducePlaylistLine(
  state: PlaylistDlState,
  line: string,
): { state: PlaylistDlState; emits: PlaylistDownloadLine[] } {
  const emits: PlaylistDownloadLine[] = []

  const item = parsePlaylistItem(line)
  if (item) {
    let downloaded = state.downloaded
    if (state.index !== null && state.dest) {
      emits.push({ type: 'track-done', index: state.index, savedPath: state.dest })
      downloaded += 1
    }
    emits.push({ type: 'item', index: item.index, total: item.total })
    return { state: { ...state, index: item.index, total: item.total, dest: null, downloaded }, emits }
  }

  const dest = parseDestination(line)
  if (dest) {
    return { state: { ...state, dest, lastFolder: path.dirname(dest) }, emits }
  }

  const percent = parseProgress(line)
  if (percent !== null) {
    emits.push({ type: 'progress', percent })
    return { state, emits }
  }

  return { state, emits }
}

// Flush the final track and emit the batch summary.
export function finalizePlaylist(
  state: PlaylistDlState,
  fallbackFolder: string,
): PlaylistDownloadLine[] {
  const emits: PlaylistDownloadLine[] = []
  let downloaded = state.downloaded
  if (state.index !== null && state.dest) {
    emits.push({ type: 'track-done', index: state.index, savedPath: state.dest })
    downloaded += 1
  }
  const total = state.total || downloaded
  emits.push({
    type: 'done',
    folder: state.lastFolder ?? fallbackFolder,
    downloaded,
    total,
    failed: Math.max(0, total - downloaded),
  })
  return emits
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `npx jest lib/__tests__/ytdlp.test.ts --no-coverage`
Expected: PASS

---

## Task 4: Playlist detect route

**Files:**
- Create: `app/api/playlist/route.ts`
- Test: `app/api/playlist/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
  parsePlaylistInfo: jest.requireActual('@/lib/ytdlp').parsePlaylistInfo,
}))
jest.mock('@/lib/validate', () => ({ isYouTubeUrl: jest.fn().mockReturnValue(true) }))

import { execArgs } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockExec = execArgs as jest.MockedFunction<typeof execArgs>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>

function req(body: unknown) {
  return new Request('http://localhost/api/playlist', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/playlist', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns parsed playlist info', async () => {
    mockExec.mockResolvedValue({
      stdout: JSON.stringify({ title: 'My Mix', entries: [{ title: 'A' }, { title: 'B' }] }),
      stderr: '', code: 0,
    })
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('My Mix')
    expect(body.count).toBe(2)
    expect(body.tracks[0]).toEqual({ index: 1, title: 'A' })
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)
    expect((await POST(req({ url: 'https://vimeo.com/x' }))).status).toBe(400)
  })

  it('returns 422 when yt-dlp fails', async () => {
    mockExec.mockResolvedValue({ stdout: '', stderr: 'ERROR: unavailable', code: 1 })
    expect((await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))).status).toBe(422)
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `npx jest app/api/playlist/__tests__/route.test.ts --no-coverage`
Expected: FAIL (route does not exist)

- [ ] **Step 3: Write minimal implementation**
```ts
import { NextResponse } from 'next/server'
import { execArgs, parsePlaylistInfo } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

export async function POST(req: Request): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => ({}))
  const url = typeof body === 'object' && body !== null && 'url' in body
    ? String((body as Record<string, unknown>).url)
    : ''

  if (!isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: 'URL must be a YouTube or YouTube Music link' },
      { status: 400 }
    )
  }

  // --flat-playlist avoids probing every video's formats (fast); user-controlled URL -> execArgs (spawn, no shell).
  const result = await execArgs(['yt-dlp', '--flat-playlist', '--dump-single-json', '--yes-playlist', url])

  if (result.code !== 0 || !result.stdout) {
    const message = result.stderr ? result.stderr.replace(/^ERROR:\s*/i, '') : 'Failed to fetch playlist'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  try {
    const info = parsePlaylistInfo(result.stdout)
    return NextResponse.json(info)
  } catch {
    return NextResponse.json({ error: 'Failed to parse playlist' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `npx jest app/api/playlist/__tests__/route.test.ts --no-coverage`
Expected: PASS

---

## Task 5: Playlist download route

**Files:**
- Create: `app/api/playlist/download/route.ts`
- Test: `app/api/playlist/download/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  reducePlaylistLine: jest.requireActual('@/lib/ytdlp').reducePlaylistLine,
  finalizePlaylist: jest.requireActual('@/lib/ytdlp').finalizePlaylist,
  initialPlaylistState: jest.requireActual('@/lib/ytdlp').initialPlaylistState,
}))
jest.mock('@/lib/validate', () => ({ isYouTubeUrl: jest.fn().mockReturnValue(true) }))

import { streamCommand } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}
function req(body: unknown) {
  return new Request('http://localhost/api/playlist/download', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/playlist/download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('emits item, track-done, and done summary', async () => {
    mockStream.mockReturnValue(fakeStream([
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Mix\\01 - A.m4a',
      '[download] 100% of 3.00MiB',
      '[download] Downloading item 2 of 2',
      '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Mix\\02 - B.m4a',
      '[download] 100% of 3.00MiB',
    ]))
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    expect(res.status).toBe(200)
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'item' && l.index === 1 && l.total === 2)).toBeDefined()
    expect(lines.filter((l) => l.type === 'track-done')).toHaveLength(2)
    const done = lines.find((l) => l.type === 'done')
    expect(done.downloaded).toBe(2)
    expect(done.total).toBe(2)
    expect(done.folder).toContain('Mix')
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)
    expect((await POST(req({ url: 'https://vimeo.com/x' }))).status).toBe(400)
  })

  it('emits error line when streamCommand throws', async () => {
    mockStream.mockReturnValue((async function* () { throw new Error('yt-dlp crashed') })())
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'error').message).toContain('crashed')
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `npx jest app/api/playlist/download/__tests__/route.test.ts --no-coverage`
Expected: FAIL (route does not exist)

- [ ] **Step 3: Write minimal implementation**
```ts
import { NextResponse } from 'next/server'
import path from 'path'
import { streamCommand, ensureOutputDir, reducePlaylistLine, finalizePlaylist, initialPlaylistState } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
import type { PlaylistDownloadLine } from '@/types/media'

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const url = typeof body === 'object' && body !== null && 'url' in body
    ? String((body as Record<string, unknown>).url)
    : ''

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }

  const outputDir = ensureOutputDir()
  const outputTemplate = path.join(outputDir, '%(playlist_title)s', '%(playlist_index)02d - %(title)s.%(ext)s')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: PlaylistDownloadLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
      // bestaudio/best = highest-quality existing audio stream, no re-encode (no ffmpeg).
      // --ignore-errors so one private/unavailable track does not abort the batch.
      const args = [
        'yt-dlp', '-f', 'bestaudio/best', '--yes-playlist',
        url, '-o', outputTemplate, '--newline', '--ignore-errors',
      ]
      try {
        let state = initialPlaylistState
        for await (const line of streamCommand(args)) {
          const { state: next, emits } = reducePlaylistLine(state, line)
          state = next
          emits.forEach(send)
        }
        finalizePlaylist(state, outputDir).forEach(send)
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}
```

- [ ] **Step 4: Run -- expect PASS**
Run: `npx jest app/api/playlist/download/__tests__/route.test.ts --no-coverage`
Expected: PASS

---

## Task 6: PlaylistPanel component

**Files:**
- Create: `components/PlaylistPanel.tsx`
- Test: `components/__tests__/PlaylistPanel.test.tsx`

- [ ] **Step 1: Write the failing test**
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import PlaylistPanel from '../PlaylistPanel'
import type { PlaylistInfo } from '@/types/media'

const info: PlaylistInfo = {
  title: 'My Mix',
  count: 3,
  tracks: [
    { index: 1, title: 'Song A' },
    { index: 2, title: 'Song B' },
    { index: 3, title: 'Song C' },
  ],
}

describe('PlaylistPanel', () => {
  it('renders playlist title, track count, and track titles', () => {
    render(<PlaylistPanel info={info} url="https://youtube.com/playlist?list=PL1" />)
    expect(screen.getByText('My Mix')).toBeInTheDocument()
    expect(screen.getByText(/3 tracks/)).toBeInTheDocument()
    expect(screen.getByText(/Song A/)).toBeInTheDocument()
    expect(screen.getByText(/Song C/)).toBeInTheDocument()
  })

  it('posts to /api/playlist/download when Download all audio is clicked', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(<PlaylistPanel info={info} url="https://youtube.com/playlist?list=PL1" />)
    fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlist/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://youtube.com/playlist?list=PL1' }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**
Run: `npx jest components/__tests__/PlaylistPanel.test.tsx --no-coverage`
Expected: FAIL (component does not exist)

- [ ] **Step 3: Write minimal implementation**
(The global fetch mock in `jest.setup.ts` returns `body: null`, so the click handler bails after `if (!res.body) return` -- the second test only asserts the call, matching the `FormatRow` precedent.)
```tsx
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
            else if (msg.type === 'error') setSummary({ folder: '', downloaded: done.size, total, failed: total - done.size })
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
```

- [ ] **Step 4: Run -- expect PASS**
Run: `npx jest components/__tests__/PlaylistPanel.test.tsx --no-coverage`
Expected: PASS

---

## Task 7: Wire playlist detection into the page

**Files:**
- Modify: `app/page.tsx`

No new test (page has no test today; behavior is covered by the route/component tests). Verify by typecheck + manual run.

- [ ] **Step 1: Add imports** (top of `app/page.tsx`)
```tsx
import PlaylistPanel from '@/components/PlaylistPanel'
import { getYouTubeUrlKind } from '@/lib/validate'
import type { MediaInfo as MediaInfoType, StatusResult, PlaylistInfo } from '@/types/media'
```
(Replace the existing `import type { MediaInfo as MediaInfoType, StatusResult } ...` line.)

- [ ] **Step 2: Add state** (next to the other `useState` calls)
```tsx
const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
```

- [ ] **Step 3: Replace `handleDetect`** with parallel video + playlist detection
```tsx
async function detectVideo(inputUrl: string) {
  try {
    const res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: inputUrl }),
    })
    const data = await res.json()
    if (!res.ok) setError(data.error ?? 'Detection failed')
    else setMediaInfo(data)
  } catch {
    setError('Network error. Is the server running?')
  }
}

async function detectPlaylist(inputUrl: string) {
  try {
    const res = await fetch('/api/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: inputUrl }),
    })
    const data = await res.json()
    if (res.ok) setPlaylistInfo(data)
    // Playlist detection failure is non-fatal -- the single-video flow may still succeed.
  } catch {
    // ignore
  }
}

async function handleDetect(inputUrl: string) {
  setUrl(inputUrl)
  setError(null)
  setMediaInfo(null)
  setPlaylistInfo(null)
  setDetecting(true)

  const kind = getYouTubeUrlKind(inputUrl)
  try {
    const tasks: Promise<void>[] = []
    if (kind.hasVideo) tasks.push(detectVideo(inputUrl))
    if (kind.hasPlaylist) tasks.push(detectPlaylist(inputUrl))
    if (tasks.length === 0) {
      setError('Enter a YouTube video or playlist link')
      return
    }
    await Promise.all(tasks)
  } finally {
    setDetecting(false)
  }
}
```

- [ ] **Step 4: Render the panel** -- add after the `{mediaInfo && (...)}` block, still inside `<main>`
```tsx
{playlistInfo && <PlaylistPanel info={playlistInfo} url={url} />}
```

- [ ] **Step 5: Typecheck + run**
Run: `npx tsc --noEmit`
Expected: PASS
Then `npm run dev`, paste a real playlist URL, confirm the panel lists tracks and "Download all audio" saves files to `Documents/MediaDetector/<playlist>/`.

---

## Task 8: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the two routes + component under Key Files**
```
app/api/playlist/route.ts          -- POST: playlist metadata via --flat-playlist --dump-single-json
app/api/playlist/download/route.ts -- POST: streaming playlist audio download, emits NDJSON
```
```
components/PlaylistPanel.tsx  -- playlist track list + "Download all audio" + overall/per-track progress
```

- [ ] **Step 2: Add a short note under Architecture Patterns**
```
### Playlist audio download

`getYouTubeUrlKind(url)` in lib/validate.ts classifies a URL as video and/or playlist
(list= param, excluding RD* radio/mix). The page fires /api/detect and /api/playlist in
parallel so a watch+list URL shows both flows. Playlist download runs ONE yt-dlp process
(`-f bestaudio/best --yes-playlist --ignore-errors`, no ffmpeg); lib/ytdlp.ts turns its
stdout into stream lines via the pure `reducePlaylistLine`/`finalizePlaylist` pair.
Playlist stream line types: `item`, `progress`, `track-done`, `done`, `error`.
```

- [ ] **Step 3: Final full test run + typecheck**
Run: `npm test -- --no-coverage`
Run: `npx tsc --noEmit`
Expected: all green.

---

## Notes / deliberate simplifications (ponytail)

- `-f bestaudio/best`, no ffmpeg -> files keep their source container (`.m4a`/`.opus`/`.webm`). Add `-x --audio-format mp3` (and an ffmpeg status check) only if uniform MP3 is later required.
- `RD*` (radio/mix) lists are treated as single videos -- they are effectively endless.
- A track whose download starts (Destination printed) but does not finish is still counted as downloaded. Upgrade the reducer to require a trailing 100% line if partial-file accuracy matters.
- The overall bar is `completed / total`; the per-track bar is the live `%`. No smoothing between them -- add fractional blending if the stepping looks abrupt.
