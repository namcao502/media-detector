# Media Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal Next.js web app that detects all video/audio stream formats from a YouTube or YouTube Music URL via yt-dlp, and downloads selected formats directly to `Documents\MediaDetector`.

**Architecture:** Next.js 15 App Router (TypeScript) with Tailwind CSS for the dark-themed UI. API routes shell out to the yt-dlp CLI for media detection and download. Downloads are saved to disk by yt-dlp; the server only streams progress text back to the browser.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, yt-dlp CLI, Jest, @testing-library/react

---

## File Map

| File | Responsibility |
|------|---------------|
| `types/media.ts` | All shared TypeScript types |
| `lib/validate.ts` | YouTube URL validation |
| `lib/ytdlp.ts` | Shell wrapper: exec, stream, parse yt-dlp output |
| `app/api/status/route.ts` | GET /api/status -- dependency check + yt-dlp auto-update |
| `app/api/detect/route.ts` | POST /api/detect -- get media formats from URL |
| `app/api/download/route.ts` | POST /api/download -- stream download progress |
| `app/api/open-folder/route.ts` | POST /api/open-folder -- open folder in Explorer |
| `app/api/ytdlp/install/route.ts` | POST /api/ytdlp/install -- pip install yt-dlp |
| `app/api/ytdlp/update/route.ts` | POST /api/ytdlp/update -- yt-dlp -U |
| `components/StatusBar.tsx` | Dependency status bar with action buttons |
| `components/UrlInput.tsx` | URL text field + Detect button |
| `components/MediaInfo.tsx` | Thumbnail, title, channel, duration card |
| `components/FormatTabs.tsx` | Video / Audio tab switcher |
| `components/FormatRow.tsx` | Single format row with Download button |
| `components/DownloadProgress.tsx` | Progress bar + Open Folder button |
| `components/LogPanel.tsx` | Scrollable live log for install/update output |
| `app/page.tsx` | Main page wiring all components |
| `app/layout.tsx` | Root layout, dark background, font |

---

## Task 1: Scaffold Next.js project and configure testing

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `jest.config.ts`
- Create: `jest.setup.ts`
- Create: `tsconfig.json` (via create-next-app)

- [ ] **Step 1: Scaffold Next.js 15 app**

```bash
cd C:/ex-project/media-detector
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --no-eslint --yes
```

Expected output: Next.js project created with `app/`, `components/` dir, `tailwind.config.ts`, `tsconfig.json`.

- [ ] **Step 2: Install testing dependencies**

```bash
npm install --save-dev jest @types/jest jest-environment-node @testing-library/react @testing-library/jest-dom @testing-library/user-event ts-jest
```

- [ ] **Step 3: Create `jest.config.ts`**

```typescript
import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
}

export default config
```

- [ ] **Step 4: Create `jest.setup.ts`**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 6: Verify scaffold works**

```bash
npm run dev
```

Expected: Next.js starts on http://localhost:3000 with the default page. Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js 15 project with TypeScript, Tailwind, and Jest"
```

---

## Task 2: Define shared TypeScript types

**Files:**
- Create: `types/media.ts`
- Create: `types/__tests__/media.test.ts`

- [ ] **Step 1: Write the type file**

Create `types/media.ts`:

```typescript
export interface VideoFormat {
  formatId: string
  ext: string
  width: number
  height: number
  fps: number | null
  vcodec: string
  filesize: number | null
}

export interface AudioFormat {
  formatId: string
  ext: string
  abr: number | null
  acodec: string
  filesize: number | null
}

export interface MediaInfo {
  title: string
  channel: string
  duration: number
  thumbnail: string
  viewCount: number | null
  videoFormats: VideoFormat[]
  audioFormats: AudioFormat[]
}

export type UpdateStatus = 'updated' | 'up-to-date' | 'failed' | 'skipped'

export interface StatusResult {
  python: { found: boolean; version: string | null }
  ytdlp: { found: boolean; version: string | null; updateStatus: UpdateStatus }
}

export interface DownloadRequest {
  url: string
  formatId: string
  title: string
  ext: string
}

export interface DownloadProgressLine {
  type: 'progress'
  percent: number
}

export interface DownloadDoneLine {
  type: 'done'
  savedPath: string
}

export interface DownloadErrorLine {
  type: 'error'
  message: string
}

export type DownloadStreamLine = DownloadProgressLine | DownloadDoneLine | DownloadErrorLine
```

- [ ] **Step 2: Create smoke test to confirm types compile**

Create `types/__tests__/media.test.ts`:

```typescript
import type { VideoFormat, AudioFormat, MediaInfo, StatusResult, DownloadStreamLine } from '../media'

describe('media types', () => {
  it('VideoFormat shape is correct', () => {
    const f: VideoFormat = {
      formatId: '137',
      ext: 'mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      vcodec: 'avc1',
      filesize: 2400000000,
    }
    expect(f.formatId).toBe('137')
  })

  it('StatusResult allows null version', () => {
    const s: StatusResult = {
      python: { found: false, version: null },
      ytdlp: { found: false, version: null, updateStatus: 'skipped' },
    }
    expect(s.python.found).toBe(false)
  })

  it('DownloadStreamLine discriminated union works', () => {
    const line: DownloadStreamLine = { type: 'progress', percent: 42 }
    if (line.type === 'progress') {
      expect(line.percent).toBe(42)
    }
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npx jest types/__tests__/media.test.ts --no-coverage
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add types/
git commit -m "feat: add shared TypeScript types for media formats, status, and download"
```

---

## Task 3: URL validation

**Files:**
- Create: `lib/validate.ts`
- Create: `lib/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/validate.test.ts`:

```typescript
import { isYouTubeUrl, extractYouTubeUrl } from '../validate'

describe('isYouTubeUrl', () => {
  it('accepts youtube.com/watch', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts music.youtube.com/watch', () => {
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts youtu.be short links', () => {
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  it('rejects non-YouTube URLs', () => {
    expect(isYouTubeUrl('https://vimeo.com/123456')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isYouTubeUrl('')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(isYouTubeUrl('not a url')).toBe(false)
  })

  it('rejects URL with youtube in path but wrong domain', () => {
    expect(isYouTubeUrl('https://evil.com/youtube.com/watch?v=x')).toBe(false)
  })
})

describe('extractYouTubeUrl', () => {
  it('returns the url trimmed', () => {
    expect(extractYouTubeUrl('  https://youtube.com/watch?v=x  ')).toBe('https://youtube.com/watch?v=x')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest lib/__tests__/validate.test.ts --no-coverage
```

Expected: FAIL -- `Cannot find module '../validate'`

- [ ] **Step 3: Implement `lib/validate.ts`**

```typescript
const YOUTUBE_HOSTS = ['www.youtube.com', 'youtube.com', 'music.youtube.com', 'youtu.be']

export function isYouTubeUrl(input: string): boolean {
  if (!input) return false
  try {
    const url = new URL(input.trim())
    return YOUTUBE_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

export function extractYouTubeUrl(input: string): string {
  return input.trim()
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest lib/__tests__/validate.test.ts --no-coverage
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/validate.ts lib/__tests__/validate.test.ts
git commit -m "feat: add YouTube URL validation"
```

---

## Task 4: yt-dlp shell wrapper

**Files:**
- Create: `lib/ytdlp.ts`
- Create: `lib/__tests__/ytdlp.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/ytdlp.test.ts`:

```typescript
import { parseProgress, parseMediaInfo, resolveOutputDir } from '../ytdlp'
import path from 'path'
import os from 'os'

describe('parseProgress', () => {
  it('parses a standard download progress line', () => {
    expect(parseProgress('[download]  72.3% of 48.00MiB at 1.23MiB/s ETA 00:12')).toBe(72.3)
  })

  it('parses 100%', () => {
    expect(parseProgress('[download] 100% of 48.00MiB')).toBe(100)
  })

  it('returns null for non-progress lines', () => {
    expect(parseProgress('[info] Downloading format 140')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseProgress('')).toBeNull()
  })
})

describe('parseMediaInfo', () => {
  const sampleDump = JSON.stringify({
    title: 'Test Video',
    uploader: 'Test Channel',
    duration: 212,
    thumbnail: 'https://example.com/thumb.jpg',
    view_count: 1000,
    formats: [
      { format_id: '137', ext: 'mp4', width: 1920, height: 1080, fps: 30, vcodec: 'avc1', acodec: 'none', filesize: 2400000000 },
      { format_id: '140', ext: 'm4a', width: null, height: null, fps: null, vcodec: 'none', acodec: 'mp4a', abr: 128, filesize: 48000000 },
      { format_id: '22', ext: 'mp4', width: 1280, height: 720, fps: 30, vcodec: 'avc1', acodec: 'mp4a', filesize: 1100000000 },
    ],
  })

  it('extracts title and channel', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.title).toBe('Test Video')
    expect(info.channel).toBe('Test Channel')
  })

  it('separates video and audio formats', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats).toHaveLength(2)
    expect(info.audioFormats).toHaveLength(1)
  })

  it('video formats have width/height', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats[0].width).toBe(1920)
    expect(info.videoFormats[0].height).toBe(1080)
  })

  it('audio formats have abr', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.audioFormats[0].abr).toBe(128)
  })

  it('sorts video formats by height descending', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats[0].height).toBeGreaterThanOrEqual(info.videoFormats[1].height)
  })
})

describe('resolveOutputDir', () => {
  it('returns path inside Documents/MediaDetector', () => {
    const dir = resolveOutputDir()
    expect(dir).toContain('MediaDetector')
    expect(path.isAbsolute(dir)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest lib/__tests__/ytdlp.test.ts --no-coverage
```

Expected: FAIL -- `Cannot find module '../ytdlp'`

- [ ] **Step 3: Implement `lib/ytdlp.ts`**

```typescript
import { exec as nodeExec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { MediaInfo, VideoFormat, AudioFormat } from '@/types/media'

const execAsync = promisify(nodeExec)

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export async function execCommand(cmd: string): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(cmd)
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return {
      stdout: e.stdout?.trim() ?? '',
      stderr: e.stderr?.trim() ?? '',
      code: e.code ?? 1,
    }
  }
}

// Merges stdout and stderr into a single stream to avoid pipe buffer deadlocks.
// Sequential for-await on stdout then stderr can deadlock if stderr fills its
// ~64KB buffer while we are still blocked reading stdout.
export async function* streamCommand(args: string[]): AsyncGenerator<string> {
  const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
  const buffer: string[] = []
  let notify: (() => void) | null = null
  let closed = false

  function push(line: string) {
    buffer.push(line)
    notify?.()
  }

  proc.stdout.on('data', (chunk: Buffer) =>
    chunk.toString('utf8').split('\n').filter(Boolean).forEach(push))
  proc.stderr.on('data', (chunk: Buffer) =>
    chunk.toString('utf8').split('\n').filter(Boolean).forEach(push))
  proc.on('close', () => { closed = true; notify?.() })

  while (!closed || buffer.length > 0) {
    if (buffer.length > 0) {
      yield buffer.shift()!
    } else {
      await new Promise<void>((r) => { notify = r })
      notify = null
    }
  }
}

// Safe alternative to execCommand for user-controlled arguments.
// Uses spawn (no shell interpolation) to prevent command injection.
export async function execArgs(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 })
    })
  })
}

export function parseProgress(line: string): number | null {
  const match = line.match(/\[download\]\s+([\d.]+)%/)
  if (!match) return null
  return parseFloat(match[1])
}

export function parseMediaInfo(jsonStr: string): MediaInfo {
  const raw = JSON.parse(jsonStr)

  const allFormats: Array<{
    format_id: string
    ext: string
    width: number | null
    height: number | null
    fps: number | null
    vcodec: string | null
    acodec: string | null
    abr?: number | null
    filesize: number | null
  }> = raw.formats ?? []

  const videoFormats: VideoFormat[] = allFormats
    .filter((f) => f.width && f.height && f.vcodec && f.vcodec !== 'none')
    .map((f) => ({
      formatId: f.format_id,
      ext: f.ext,
      width: f.width!,
      height: f.height!,
      fps: f.fps ?? null,
      vcodec: f.vcodec!,
      filesize: f.filesize ?? null,
    }))
    .sort((a, b) => b.height - a.height)

  const audioFormats: AudioFormat[] = allFormats
    .filter((f) => (!f.width || !f.height) && f.acodec && f.acodec !== 'none' && f.vcodec === 'none')
    .map((f) => ({
      formatId: f.format_id,
      ext: f.ext,
      abr: f.abr ?? null,
      acodec: f.acodec!,
      filesize: f.filesize ?? null,
    }))
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))

  return {
    title: raw.title ?? 'Unknown',
    channel: raw.uploader ?? raw.channel ?? 'Unknown',
    duration: raw.duration ?? 0,
    thumbnail: raw.thumbnail ?? '',
    viewCount: raw.view_count ?? null,
    videoFormats,
    audioFormats,
  }
}

export function parseDestination(line: string): string | null {
  const downloadMatch = line.match(/\[download\] Destination: (.+)$/)
  if (downloadMatch) return downloadMatch[1].trim()
  const mergerMatch = line.match(/\[Merger\] Merging formats into "(.+)"$/)
  if (mergerMatch) return mergerMatch[1].trim()
  return null
}

export function resolveOutputDir(): string {
  const documentsDir = path.join(os.homedir(), 'Documents')
  return path.join(documentsDir, 'MediaDetector')
}

export function ensureOutputDir(): string {
  const dir = resolveOutputDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest lib/__tests__/ytdlp.test.ts --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ytdlp.ts lib/__tests__/ytdlp.test.ts
git commit -m "feat: add yt-dlp shell wrapper with progress parser and format extractor"
```

---

## Task 5: GET /api/status route

**Files:**
- Create: `app/api/status/route.ts`
- Create: `app/api/status/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/status/__tests__/route.test.ts`:

```typescript
import { GET } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execCommand: jest.fn(),
}))

import { execCommand } from '@/lib/ytdlp'
const mockExec = execCommand as jest.MockedFunction<typeof execCommand>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/status', () => {
  it('returns python and ytdlp info when both are installed', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Python 3.12.2', stderr: '', code: 0 }) // python --version
      .mockResolvedValueOnce({ stdout: '2025.04.15', stderr: '', code: 0 })    // yt-dlp --version
      .mockResolvedValueOnce({ stdout: 'yt-dlp is up to date', stderr: '', code: 0 }) // yt-dlp -U

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.python.found).toBe(true)
    expect(body.python.version).toBe('3.12.2')
    expect(body.ytdlp.found).toBe(true)
    expect(body.ytdlp.version).toBe('2025.04.15')
    expect(body.ytdlp.updateStatus).toBe('up-to-date')
  })

  it('returns found: false when python is missing', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: 'command not found', code: 1 }) // python
      .mockResolvedValueOnce({ stdout: '', stderr: 'command not found', code: 1 }) // python3

    const res = await GET()
    const body = await res.json()

    expect(body.python.found).toBe(false)
    expect(body.ytdlp.updateStatus).toBe('skipped')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest app/api/status/__tests__/route.test.ts --no-coverage
```

Expected: FAIL -- `Cannot find module '../route'`

- [ ] **Step 3: Implement `app/api/status/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { execCommand } from '@/lib/ytdlp'
import type { StatusResult, UpdateStatus } from '@/types/media'

let cachedStatus: StatusResult | null = null

async function checkPython(): Promise<{ found: boolean; version: string | null }> {
  for (const cmd of ['python --version', 'python3 --version']) {
    const result = await execCommand(cmd)
    if (result.code === 0) {
      const match = result.stdout.match(/Python ([\d.]+)/)
      return { found: true, version: match ? match[1] : result.stdout }
    }
  }
  return { found: false, version: null }
}

async function checkYtdlp(): Promise<{ found: boolean; version: string | null }> {
  const result = await execCommand('yt-dlp --version')
  if (result.code === 0) {
    return { found: true, version: result.stdout.trim() }
  }
  return { found: false, version: null }
}

async function updateYtdlp(): Promise<UpdateStatus> {
  const result = await execCommand('yt-dlp -U')
  if (result.code !== 0) return 'failed'
  const out = result.stdout.toLowerCase()
  if (out.includes('up to date') || out.includes('up-to-date')) return 'up-to-date'
  return 'updated'
}

export async function GET(): Promise<NextResponse> {
  if (cachedStatus) {
    return NextResponse.json(cachedStatus)
  }

  const python = await checkPython()
  let ytdlp: StatusResult['ytdlp'] = { found: false, version: null, updateStatus: 'skipped' }

  if (python.found) {
    const ytdlpCheck = await checkYtdlp()
    if (ytdlpCheck.found) {
      const updateStatus = await updateYtdlp()
      ytdlp = { ...ytdlpCheck, updateStatus }
    } else {
      ytdlp = { found: false, version: null, updateStatus: 'skipped' }
    }
  }

  cachedStatus = { python, ytdlp }
  return NextResponse.json(cachedStatus)
}

// Exported for testing -- resets the cache
export function resetStatusCache(): void {
  cachedStatus = null
}
```

- [ ] **Step 4: Update test to use resetStatusCache**

Update `app/api/status/__tests__/route.test.ts` -- replace `beforeEach`:

```typescript
import { GET, resetStatusCache } from '../route'

// ... (keep mock setup above)

beforeEach(() => {
  jest.clearAllMocks()
  resetStatusCache()
})
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest app/api/status/__tests__/route.test.ts --no-coverage
```

Expected: Both tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/status/
git commit -m "feat: add GET /api/status with Python and yt-dlp dependency check"
```

---

## Task 6: POST /api/detect route

**Files:**
- Create: `app/api/detect/route.ts`
- Create: `app/api/detect/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/detect/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
  parseMediaInfo: jest.requireActual('@/lib/ytdlp').parseMediaInfo,
}))

import { execArgs } from '@/lib/ytdlp'
const mockExec = execArgs as jest.MockedFunction<typeof execArgs>

const sampleDump = JSON.stringify({
  title: 'Test Video',
  uploader: 'Test Channel',
  duration: 212,
  thumbnail: 'https://example.com/thumb.jpg',
  view_count: 1000,
  formats: [
    { format_id: '137', ext: 'mp4', width: 1920, height: 1080, fps: 30, vcodec: 'avc1', acodec: 'none', filesize: 2400000000 },
    { format_id: '140', ext: 'm4a', width: null, height: null, fps: null, vcodec: 'none', acodec: 'mp4a', abr: 128, filesize: 48000000 },
  ],
})

describe('POST /api/detect', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns media info for a valid YouTube URL', async () => {
    mockExec.mockResolvedValueOnce({ stdout: sampleDump, stderr: '', code: 0 })

    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.title).toBe('Test Video')
    expect(body.videoFormats).toHaveLength(1)
    expect(body.audioFormats).toHaveLength(1)
  })

  it('returns 400 for a non-YouTube URL', async () => {
    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vimeo.com/123' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/YouTube/)
  })

  it('returns 422 when yt-dlp reports an error', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'ERROR: Video unavailable', code: 1 })

    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=invalid' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('unavailable')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest app/api/detect/__tests__/route.test.ts --no-coverage
```

Expected: FAIL -- `Cannot find module '../route'`

- [ ] **Step 3: Implement `app/api/detect/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { execArgs, parseMediaInfo } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const url: string = body?.url ?? ''

  if (!isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: 'URL must be a YouTube or YouTube Music link' },
      { status: 400 }
    )
  }

  // Use execArgs (spawn, no shell) to prevent command injection from URL values.
  const result = await execArgs(['yt-dlp', '--dump-json', url, '--no-playlist'])

  if (result.code !== 0 || !result.stdout) {
    const message = result.stderr
      ? result.stderr.replace(/^ERROR:\s*/i, '')
      : 'Failed to fetch media info'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  try {
    const info = parseMediaInfo(result.stdout)
    return NextResponse.json(info)
  } catch {
    return NextResponse.json({ error: 'Failed to parse media info' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest app/api/detect/__tests__/route.test.ts --no-coverage
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/detect/
git commit -m "feat: add POST /api/detect for YouTube media format detection"
```

---

## Task 7: POST /api/download route

**Files:**
- Create: `app/api/download/route.ts`
- Create: `app/api/download/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/download/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  resolveOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  parseProgress: jest.requireActual('@/lib/ytdlp').parseProgress,
  parseDestination: jest.requireActual('@/lib/ytdlp').parseDestination,
}))
jest.mock('@/lib/validate', () => ({
  isYouTubeUrl: jest.fn().mockReturnValue(true),
}))

import { streamCommand, ensureOutputDir } from '@/lib/ytdlp'
const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockEnsureDir = ensureOutputDir as jest.MockedFunction<typeof ensureOutputDir>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('POST /api/download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('streams progress lines and done event', async () => {
    mockEnsureDir.mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector')
    mockStream.mockReturnValue(
      fakeStream([
        '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Test.m4a',
        '[download]  50.0% of 48.00MiB at 1.23MiB/s ETA 00:20',
        '[download] 100% of 48.00MiB at 1.23MiB/s ETA 00:00',
      ])
    )

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))

    const progressLine = lines.find((l) => l.type === 'progress' && l.percent === 50)
    expect(progressLine).toBeDefined()

    const doneLine = lines.find((l) => l.type === 'done')
    expect(doneLine).toBeDefined()
    expect(doneLine.savedPath).toContain('MediaDetector')
  })

  it('returns 400 for invalid URL', async () => {
    const { isYouTubeUrl } = require('@/lib/validate')
    isYouTubeUrl.mockReturnValueOnce(false)

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vimeo.com/x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest app/api/download/__tests__/route.test.ts --no-coverage
```

Expected: FAIL -- `Cannot find module '../route'`

- [ ] **Step 3: Implement `app/api/download/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import path from 'path'
import { streamCommand, ensureOutputDir, parseProgress, resolveOutputDir, parseDestination } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
import type { DownloadStreamLine } from '@/types/media'

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { url, formatId, title, ext } = body as {
    url?: string
    formatId?: string
    title?: string
    ext?: string
  }

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }
  if (!formatId || !title || !ext) {
    return NextResponse.json({ error: 'Missing formatId, title, or ext' }, { status: 400 })
  }

  const outputDir = ensureOutputDir()
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const args = ['yt-dlp', '-f', formatId, url, '-o', outputTemplate, '--no-playlist', '--newline']

      try {
        // Track the actual path yt-dlp writes to (may differ from title due to filename sanitization).
        let detectedPath: string | null = null

        for await (const line of streamCommand(args)) {
          const percent = parseProgress(line)
          if (percent !== null) {
            const msg: DownloadStreamLine = { type: 'progress', percent }
            controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
          }
          const dest = parseDestination(line)
          if (dest) detectedPath = dest
        }

        // Prefer the path yt-dlp reported; fall back to constructed path.
        const savedPath = detectedPath ?? path.join(resolveOutputDir(), `${title}.${ext}`)
        const done: DownloadStreamLine = { type: 'done', savedPath }
        controller.enqueue(encoder.encode(JSON.stringify(done) + '\n'))
      } catch (err) {
        const error: DownloadStreamLine = { type: 'error', message: String(err) }
        controller.enqueue(encoder.encode(JSON.stringify(error) + '\n'))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest app/api/download/__tests__/route.test.ts --no-coverage
```

Expected: Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/download/
git commit -m "feat: add POST /api/download with streaming progress via yt-dlp"
```

---

## Task 8: Remaining API routes (open-folder, ytdlp/install, ytdlp/update)

**Files:**
- Create: `app/api/open-folder/route.ts`
- Create: `app/api/ytdlp/install/route.ts`
- Create: `app/api/ytdlp/update/route.ts`
- Create: `app/api/open-folder/__tests__/route.test.ts`
- Create: `app/api/ytdlp/install/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests for open-folder**

Create `app/api/open-folder/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execCommand: jest.fn(),
}))

import { execCommand } from '@/lib/ytdlp'
const mockExec = execCommand as jest.MockedFunction<typeof execCommand>

describe('POST /api/open-folder', () => {
  it('opens the folder and returns 200', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })

    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\Users\\test\\Documents\\MediaDetector' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('MediaDetector')
    )
  })

  it('returns 400 when path is missing', async () => {
    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Write failing tests for ytdlp/install**

Create `app/api/ytdlp/install/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
}))

import { streamCommand } from '@/lib/ytdlp'
const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('POST /api/ytdlp/install', () => {
  it('streams pip install output', async () => {
    mockStream.mockReturnValue(fakeStream(['Collecting yt-dlp', 'Successfully installed yt-dlp-2025.04.15']))

    const req = new Request('http://localhost/api/ytdlp/install', { method: 'POST' })
    const res = await POST(req)

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Successfully installed')
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest app/api/open-folder/__tests__/route.test.ts app/api/ytdlp/install/__tests__/route.test.ts --no-coverage
```

Expected: FAIL -- modules not found.

- [ ] **Step 4: Implement `app/api/open-folder/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { execCommand } from '@/lib/ytdlp'

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}))
  const folderPath: string = body?.path ?? ''

  if (!folderPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  await execCommand(`explorer.exe "${folderPath}"`)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Implement `app/api/ytdlp/install/route.ts`**

```typescript
import { streamCommand } from '@/lib/ytdlp'

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const line of streamCommand(['pip', 'install', 'yt-dlp'])) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
```

- [ ] **Step 6: Implement `app/api/ytdlp/update/route.ts`**

```typescript
import { streamCommand } from '@/lib/ytdlp'

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const line of streamCommand(['yt-dlp', '-U'])) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx jest app/api/open-folder/__tests__/route.test.ts app/api/ytdlp/install/__tests__/route.test.ts --no-coverage
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/open-folder/ app/api/ytdlp/
git commit -m "feat: add open-folder, ytdlp install, and ytdlp update API routes"
```

---

## Task 9: StatusBar component

**Files:**
- Create: `components/StatusBar.tsx`
- Create: `components/LogPanel.tsx`
- Create: `components/__tests__/StatusBar.test.tsx`

- [ ] **Step 1: Configure jest for jsdom (components need DOM)**

Update `jest.config.ts` -- add a `projects` array to handle both node (API) and jsdom (components) environments:

```typescript
import type { Config } from 'jest'

const config: Config = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      // lib and types tests use Node.js APIs (child_process, fs, os) -- must stay in node.
      testMatch: ['**/app/api/**/*.test.ts', '**/lib/**/*.test.ts', '**/types/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['**/components/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    },
  ],
}

export default config
```

- [ ] **Step 2: Write failing tests for StatusBar**

Create `components/__tests__/StatusBar.test.tsx`:

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

describe('StatusBar', () => {
  it('shows green status when all dependencies are OK', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Python 3.12.2/)).toBeInTheDocument()
    expect(screen.getByText(/2025.04.15/)).toBeInTheDocument()
  })

  it('shows Install Python button when Python is missing', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Install Python/i)).toBeInTheDocument()
  })

  it('shows Install yt-dlp button when yt-dlp is missing', () => {
    render(<StatusBar status={noYtdlp} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Install/i)).toBeInTheDocument()
  })

  it('calls onRefresh after install completes', async () => {
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
    fireEvent.click(screen.getByText(/Install/i))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest components/__tests__/StatusBar.test.tsx --no-coverage
```

Expected: FAIL -- `Cannot find module '../StatusBar'`

- [ ] **Step 4: Implement `components/LogPanel.tsx`**

```typescript
'use client'

interface LogPanelProps {
  lines: string[]
  visible: boolean
}

export default function LogPanel({ lines, visible }: LogPanelProps) {
  if (!visible || lines.length === 0) return null
  return (
    <div className="mt-2 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-xs text-green-400">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Implement `components/StatusBar.tsx`**

```typescript
'use client'

import { useState } from 'react'
import type { StatusResult } from '@/types/media'
import LogPanel from './LogPanel'

interface StatusBarProps {
  status: StatusResult | null
  onRefresh: () => void
}

async function streamToLines(url: string, method: string, onLine: (line: string) => void): Promise<void> {
  const res = await fetch(url, { method })
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    text.split('\n').filter(Boolean).forEach(onLine)
  }
}

export default function StatusBar({ status, onRefresh }: StatusBarProps) {
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  const allOk = status?.python.found && status?.ytdlp.found

  async function handleInstall(endpoint: string) {
    setLoading(true)
    setLogLines([])
    setShowLog(true)
    await streamToLines(endpoint, 'POST', (line) => setLogLines((prev) => [...prev, line]))
    setLoading(false)
    onRefresh()
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-400">
        <span className="animate-pulse">Checking dependencies...</span>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-gray-800 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        {/* Python */}
        <div className="flex items-center gap-2">
          {status.python.found ? (
            <span className="text-green-400">Python {status.python.version}</span>
          ) : (
            <>
              <span className="text-red-400">Python not found</span>
              <a
                href="https://python.org/downloads"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500"
              >
                Install Python
              </a>
            </>
          )}
        </div>

        {/* yt-dlp */}
        <div className="flex items-center gap-2">
          {status.ytdlp.found ? (
            <span className={status.ytdlp.updateStatus === 'updated' ? 'text-green-400' : 'text-gray-400'}>
              yt-dlp {status.ytdlp.version}
              {status.ytdlp.updateStatus === 'updated' && ' (updated)'}
            </span>
          ) : (
            <>
              <span className="text-red-400">yt-dlp not installed</span>
              {status.python.found && (
                <button
                  onClick={() => handleInstall('/api/ytdlp/install')}
                  disabled={loading}
                  className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {loading ? 'Installing...' : 'Install'}
                </button>
              )}
            </>
          )}
          {status.ytdlp.updateStatus === 'failed' && (
            <button
              onClick={() => handleInstall('/api/ytdlp/update')}
              disabled={loading}
              className="rounded bg-yellow-600 px-2 py-0.5 text-xs text-white hover:bg-yellow-500 disabled:opacity-50"
            >
              {loading ? 'Retrying...' : 'Retry'}
            </button>
          )}
        </div>

        {allOk && (
          <span className="ml-auto text-xs text-gray-500">
            {status.ytdlp.updateStatus === 'up-to-date' ? 'Up to date' : ''}
          </span>
        )}
      </div>

      <LogPanel lines={logLines} visible={showLog} />
    </div>
  )
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest components/__tests__/StatusBar.test.tsx --no-coverage
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/StatusBar.tsx components/LogPanel.tsx components/__tests__/StatusBar.test.tsx jest.config.ts
git commit -m "feat: add StatusBar and LogPanel components with install/update flow"
```

---

## Task 10: UrlInput component

**Files:**
- Create: `components/UrlInput.tsx`
- Create: `components/__tests__/UrlInput.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `components/__tests__/UrlInput.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import UrlInput from '../UrlInput'

describe('UrlInput', () => {
  it('renders the URL input and Detect button', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={false} />)
    expect(screen.getByPlaceholderText(/youtube/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detect/i })).toBeInTheDocument()
  })

  it('calls onDetect with the trimmed URL when form is submitted', () => {
    const onDetect = jest.fn()
    render(<UrlInput onDetect={onDetect} disabled={false} loading={false} />)
    fireEvent.change(screen.getByPlaceholderText(/youtube/i), {
      target: { value: '  https://youtube.com/watch?v=x  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /detect/i }))
    expect(onDetect).toHaveBeenCalledWith('https://youtube.com/watch?v=x')
  })

  it('disables the button when disabled prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={true} loading={false} />)
    expect(screen.getByRole('button', { name: /detect/i })).toBeDisabled()
  })

  it('shows loading state when loading prop is true', () => {
    render(<UrlInput onDetect={jest.fn()} disabled={false} loading={true} />)
    expect(screen.getByRole('button')).toHaveTextContent(/detecting/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest components/__tests__/UrlInput.test.tsx --no-coverage
```

Expected: FAIL -- `Cannot find module '../UrlInput'`

- [ ] **Step 3: Implement `components/UrlInput.tsx`**

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
        className="flex-1 rounded-lg bg-[#0f3460] px-4 py-3 text-gray-200 placeholder-gray-500 outline-none focus:ring-2 focus:ring-[#e94560] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || loading || !value.trim()}
        className="rounded-lg bg-[#e94560] px-6 py-3 font-semibold text-white hover:bg-[#d63651] disabled:opacity-50"
      >
        {loading ? 'Detecting...' : 'Detect'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest components/__tests__/UrlInput.test.tsx --no-coverage
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/UrlInput.tsx components/__tests__/UrlInput.test.tsx
git commit -m "feat: add UrlInput component"
```

---

## Task 11: MediaInfo, FormatTabs, FormatRow, DownloadProgress components

**Files:**
- Create: `components/MediaInfo.tsx`
- Create: `components/FormatTabs.tsx`
- Create: `components/FormatRow.tsx`
- Create: `components/DownloadProgress.tsx`
- Create: `components/__tests__/FormatRow.test.tsx`
- Create: `components/__tests__/DownloadProgress.test.tsx`

- [ ] **Step 1: Write failing tests for FormatRow**

Create `components/__tests__/FormatRow.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import FormatRow from '../FormatRow'
import type { VideoFormat } from '@/types/media'

const videoFormat: VideoFormat = {
  formatId: '137',
  ext: 'mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  vcodec: 'avc1',
  filesize: 2400000000,
}

describe('FormatRow (video)', () => {
  it('displays resolution, codec, and file size', () => {
    render(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        onDownloadStart={jest.fn()}
      />
    )
    expect(screen.getByText(/1080p/)).toBeInTheDocument()
    expect(screen.getByText(/avc1/i)).toBeInTheDocument()
  })

  it('calls onDownloadStart when Download is clicked', () => {
    const onDownloadStart = jest.fn()
    render(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        onDownloadStart={onDownloadStart}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(onDownloadStart).toHaveBeenCalledWith('137', 'mp4')
  })
})
```

- [ ] **Step 2: Write failing tests for DownloadProgress**

Create `components/__tests__/DownloadProgress.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import DownloadProgress from '../DownloadProgress'

describe('DownloadProgress', () => {
  it('shows progress bar with percentage', () => {
    render(<DownloadProgress percent={65} savedPath={null} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText(/65%/)).toBeInTheDocument()
  })

  it('shows Open Folder button when savedPath is set', () => {
    render(<DownloadProgress percent={100} savedPath="C:\\Users\\test\\Documents\\MediaDetector\\test.mp4" />)
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument()
    expect(screen.getByText(/Saved to/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest components/__tests__/FormatRow.test.tsx components/__tests__/DownloadProgress.test.tsx --no-coverage
```

Expected: FAIL -- modules not found.

- [ ] **Step 4: Implement `components/DownloadProgress.tsx`**

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
        className="h-2 w-full overflow-hidden rounded-full bg-gray-700"
      >
        <div
          className="h-full bg-[#e94560] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{percent}%</span>
        {savedPath && (
          <div className="flex items-center gap-2">
            <span className="text-green-400">Saved to Documents\MediaDetector</span>
            <button
              onClick={handleOpenFolder}
              className="rounded bg-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-600"
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

- [ ] **Step 5: Implement `components/FormatRow.tsx`**

```typescript
'use client'

import { useState } from 'react'
import type { VideoFormat, AudioFormat } from '@/types/media'
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

  const label = type === 'video'
    ? `${(format as VideoFormat).height}p`
    : `${(format as AudioFormat).abr ?? '?'}kbps`

  const codec = type === 'video'
    ? (format as VideoFormat).vcodec
    : (format as AudioFormat).acodec

  async function handleDownload() {
    setDownloading(true)
    setPercent(0)
    setSavedPath(null)
    onDownloadStart(format.formatId, format.ext)

    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formatId: format.formatId, title, ext: format.ext }),
    })

    if (!res.body) { setDownloading(false); return }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value).split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'progress') setPercent(parsed.percent)
          if (parsed.type === 'done') { setSavedPath(parsed.savedPath); setPercent(100) }
        } catch {}
      }
    }
    setDownloading(false)
  }

  return (
    <div className="rounded-lg bg-[#16213e] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded bg-[#0f3460] px-2 py-0.5 text-xs font-bold text-blue-300">{label}</span>
          <div>
            <span className="text-sm text-gray-200">{format.ext.toUpperCase()}</span>
            <span className="ml-2 text-xs text-gray-500">{codec}</span>
            {type === 'video' && (format as VideoFormat).fps && (
              <span className="ml-2 text-xs text-gray-500">{(format as VideoFormat).fps}fps</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{formatFilesize(format.filesize)}</span>
          {!downloading && !savedPath && (
            <button
              onClick={handleDownload}
              className="rounded bg-[#e94560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d63651]"
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

- [ ] **Step 6: Implement `components/MediaInfo.tsx`**

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
    <div className="flex gap-4 rounded-lg bg-[#16213e] p-4">
      {info.thumbnail && (
        <img
          src={info.thumbnail}
          alt={info.title}
          className="h-20 w-36 rounded object-cover"
        />
      )}
      <div className="flex flex-col justify-center">
        <h2 className="font-semibold text-gray-100">{info.title}</h2>
        <div className="mt-1 flex gap-3 text-xs text-gray-400">
          <span>{info.channel}</span>
          <span>{formatDuration(info.duration)}</span>
          {info.viewCount && <span>{formatViews(info.viewCount)}</span>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Implement `components/FormatTabs.tsx`**

```typescript
'use client'

import { useState } from 'react'
import type { MediaInfo } from '@/types/media'
import FormatRow from './FormatRow'

interface FormatTabsProps {
  info: MediaInfo
  url: string
}

export default function FormatTabs({ info, url }: FormatTabsProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')

  return (
    <div>
      <div className="mb-4 flex border-b border-[#0f3460]">
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-[#e94560] text-gray-100'
                : 'text-gray-500 hover:text-gray-300'
            }`}
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
              onDownloadStart={() => {}}
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
              onDownloadStart={() => {}}
            />
          ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
npx jest components/__tests__/FormatRow.test.tsx components/__tests__/DownloadProgress.test.tsx --no-coverage
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add components/
git commit -m "feat: add MediaInfo, FormatTabs, FormatRow, and DownloadProgress components"
```

---

## Task 12: Main page and layout

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Implement `app/layout.tsx`**

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Media Detector',
  description: 'Detect and download media from YouTube',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-[#1a1a2e] text-gray-100`}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Implement `app/page.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import StatusBar from '@/components/StatusBar'
import UrlInput from '@/components/UrlInput'
import MediaInfo from '@/components/MediaInfo'
import FormatTabs from '@/components/FormatTabs'
import type { MediaInfo as MediaInfoType, StatusResult } from '@/types/media'

export default function Home() {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [url, setUrl] = useState('')
  const [mediaInfo, setMediaInfo] = useState<MediaInfoType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const depsReady = status?.python.found && status?.ytdlp.found

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setStatus(data)
    } catch {
      // status will remain null, showing loading state
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  async function handleDetect(inputUrl: string) {
    setUrl(inputUrl)
    setError(null)
    setMediaInfo(null)
    setDetecting(true)

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Detection failed')
      } else {
        setMediaInfo(data)
      }
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold uppercase tracking-widest text-gray-100">
          Media Detector
        </h1>
        <p className="mt-1 text-xs text-gray-500">YouTube & YouTube Music</p>
      </div>

      <StatusBar status={status} onRefresh={fetchStatus} />

      <UrlInput
        onDetect={handleDetect}
        disabled={!depsReady}
        loading={detecting}
      />

      {error && (
        <div className="rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {mediaInfo && (
        <div className="space-y-4">
          <MediaInfo info={mediaInfo} />
          <FormatTabs info={mediaInfo} url={url} />
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Start the dev server and verify the UI loads**

```bash
npm run dev
```

Open http://localhost:3000.

Expected:
- Title "MEDIA DETECTOR" visible
- Status bar shows dependency status
- URL input is present (disabled if deps missing, enabled if deps OK)
- No console errors in the browser

- [ ] **Step 4: Test with a real YouTube URL (manual smoke test)**

Paste `https://www.youtube.com/watch?v=dQw4w9WgXcQ` into the URL field and click Detect.

Expected:
- Info card shows "Never Gonna Give You Up", Rick Astley, thumbnail
- Video tab shows format rows (1080p, 720p, etc.)
- Audio tab shows M4A format rows
- Clicking Download starts download, progress bar appears, file saved to `Documents\MediaDetector`

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "feat: wire up main page with status bar, URL input, and results panel"
```

---

## Task 13: Run full test suite and fix any issues

- [ ] **Step 1: Run all tests**

```bash
npm test -- --no-coverage
```

Expected: All tests pass. If any fail, fix the failing tests before proceeding.

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit if any fixes were made**

```bash
git add -A
git commit -m "fix: resolve test and type issues from full suite run"
```

---

## Self-Review: Spec vs Plan Coverage

| Spec requirement | Covered by task |
|------------------|----------------|
| YouTube + YouTube Music URL support | Task 3 (validate.ts) |
| yt-dlp-based stream detection | Task 4 (ytdlp.ts) + Task 6 (detect route) |
| Status bar with Python/yt-dlp check | Task 5 (status route) + Task 9 (StatusBar component) |
| Install Python button (opens browser) | Task 9 (StatusBar -- anchor tag to python.org) |
| Install yt-dlp button with streaming log | Task 8 (install route) + Task 9 (StatusBar + LogPanel) |
| Update yt-dlp on startup | Task 5 (status route runs yt-dlp -U) |
| Retry button on update failure | Task 9 (StatusBar -- updateStatus === 'failed') |
| Detect button disabled until deps OK | Task 10 (UrlInput disabled prop) + Task 12 (page.tsx) |
| Media info card (title, channel, duration, thumbnail) | Task 11 (MediaInfo) |
| Video tab sorted by resolution desc | Task 4 (parseMediaInfo sorts by height desc) |
| Audio tab sorted by bitrate desc | Task 4 (parseMediaInfo sorts by abr desc) |
| Format rows with resolution, codec, fps, size | Task 11 (FormatRow) |
| Download saves to Documents\MediaDetector | Task 4 (resolveOutputDir) + Task 7 (download route) |
| Streaming progress bar during download | Task 7 (download route streams NDJSON) + Task 11 (DownloadProgress) |
| "Saved to Documents\MediaDetector" on completion | Task 11 (DownloadProgress -- savedPath) |
| Open Folder button (Windows explorer.exe) | Task 8 (open-folder route) + Task 11 (DownloadProgress) |
| Error handling (invalid URL, unavailable video) | Task 6 (detect route) + Task 7 (download route) |
| --no-playlist enforced | Task 6 (detect) + Task 7 (download) |
