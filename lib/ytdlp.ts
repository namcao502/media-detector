import { exec as nodeExec, spawn } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { MediaInfo, VideoFormat, AudioFormat, PlaylistInfo, PlaylistDownloadLine } from '@/types/media'

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

// Safe alternative to execCommand for user-controlled arguments.
// Uses spawn (no shell interpolation) to prevent command injection.
export async function execArgs(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    proc.on('error', (err: Error) => {
      resolve({ stdout: '', stderr: err.message, code: 1 })
    })
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 })
    })
  })
}

// A fresh python.org install has `python` on PATH but often no bare `pip` (its
// Scripts dir is not added), so always invoke pip as `<python> -m pip`.
let cachedPython: string | null = null
export async function resolvePython(): Promise<string> {
  if (cachedPython) return cachedPython
  for (const cmd of ['python', 'python3']) {
    if ((await execCommand(`${cmd} --version`)).code === 0) return (cachedPython = cmd)
  }
  return 'python' // ponytail: default; the pip command then surfaces the real error
}

export async function pipArgs(...args: string[]): Promise<string[]> {
  return [await resolvePython(), '-m', 'pip', ...args]
}

// yt-dlp installs a `yt-dlp` shim into Python's Scripts dir, which a fresh
// python.org install does not add to PATH. Run it as a module so it works
// wherever `python` does.
export async function ytdlpArgs(...args: string[]): Promise<string[]> {
  return [await resolvePython(), '-m', 'yt_dlp', ...args]
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
  proc.on('error', (err: Error) => {
    push(`ERROR: ${err.message}`)
    closed = true
    notify?.()
  })
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

// Debian/Ubuntu mark the system Python as externally managed (PEP 668), so a
// plain `pip install` refuses and hints at --break-system-packages.
export function isExternallyManaged(output: string): boolean {
  return /externally[- ]managed|break-system-packages/i.test(output)
}

// Stream a `python -m pip` command. If PEP 668 blocks it (system Python on
// Ubuntu/Debian), retry once with --user --break-system-packages, which
// installs into ~/.local so `python -m yt_dlp` still finds it without root.
export async function* pipStream(...pipSubArgs: string[]): AsyncGenerator<string> {
  const base = await pipArgs(...pipSubArgs)
  let managed = false
  for await (const line of streamCommand(base)) {
    if (isExternallyManaged(line)) managed = true
    yield line
  }
  if (managed) {
    yield '[media-detector] System Python is externally managed (PEP 668); retrying with --user --break-system-packages...'
    for await (const line of streamCommand([...base, '--user', '--break-system-packages'])) {
      yield line
    }
  }
}

export function parseProgress(line: string): number | null {
  const match = line.match(/\[download\]\s+([\d.]+)%/)
  if (!match) return null
  return parseFloat(match[1])
}

export function parseDestination(line: string): string | null {
  const downloadMatch = line.match(/\[download\] Destination: (.+)$/)
  if (downloadMatch) return downloadMatch[1].trim()
  const mergerMatch = line.match(/\[Merger\] Merging formats into "(.+)"$/)
  if (mergerMatch) return mergerMatch[1].trim()
  return null
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

export function resolveOutputDir(): string {
  const documentsDir = path.join(os.homedir(), 'Documents')
  return path.join(documentsDir, 'MediaDetector')
}

export function ensureOutputDir(): string {
  const dir = resolveOutputDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const FFMPEG_EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

// Returns the first dir that contains an ffmpeg binary, or null. Pure -- testable.
export function firstDirWithFfmpeg(dirs: string[]): string | null {
  for (const dir of dirs) {
    if (fs.existsSync(path.join(dir, FFMPEG_EXE))) return dir
  }
  return null
}

// winget installs the Gyan.FFmpeg archive package under Packages/<pkg>/<ffmpeg-ver>/bin/
// (nested, versioned) without a Links shim or PATH entry, so we discover that bin dir.
function wingetFfmpegBinDirs(): string[] {
  const local = process.env.LOCALAPPDATA
  if (!local) return []
  const pkgRoot = path.join(local, 'Microsoft', 'WinGet', 'Packages')
  const out: string[] = []
  try {
    for (const pkg of fs.readdirSync(pkgRoot)) {
      if (!/ffmpeg/i.test(pkg)) continue
      const pkgDir = path.join(pkgRoot, pkg)
      let subs: string[] = []
      try { subs = fs.readdirSync(pkgDir) } catch { continue }
      for (const sub of subs) out.push(path.join(pkgDir, sub, 'bin'))
    }
  } catch {
    // Packages dir does not exist -- nothing installed via winget
  }
  return out
}

// Dirs to look for a vendored / package-manager-installed ffmpeg, in priority order:
// repo-local bin/, winget's shim dir, Chocolatey's shim dir, then winget's extracted
// package dirs. Checking these lets a `winget`/`choco` install be detected without
// restarting the dev server, whose PATH snapshot would not yet include the new install.
function ffmpegDirCandidates(): string[] {
  const dirs = [path.join(process.cwd(), 'bin')]
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) dirs.push(path.join(local, 'Microsoft', 'WinGet', 'Links'))
    dirs.push('C:\\ProgramData\\chocolatey\\bin')
    dirs.push(...wingetFfmpegBinDirs())
  }
  return dirs
}

export function resolveFfmpegDir(): string | null {
  return firstDirWithFfmpeg(ffmpegDirCandidates())
}

// Point yt-dlp at the resolved ffmpeg/ffprobe dir when found; [] otherwise (uses PATH).
export function ffmpegLocationArgs(): string[] {
  const dir = resolveFfmpegDir()
  return dir ? ['--ffmpeg-location', dir] : []
}

export async function checkFfmpeg(): Promise<{ found: boolean; version: string | null }> {
  const dir = resolveFfmpegDir()
  const cmd = dir ? `"${path.join(dir, FFMPEG_EXE)}" -version` : 'ffmpeg -version'
  const result = await execCommand(cmd)
  if (result.code !== 0) return { found: false, version: null }
  const match = result.stdout.match(/ffmpeg version (\S+)/)
  return { found: true, version: match ? match[1] : null }
}

// Containers yt-dlp can embed a cover-art thumbnail into. Notably NOT webm --
// passing --embed-thumbnail for a webm output makes yt-dlp error in postprocessing.
const THUMBNAIL_EXTS = new Set(['mp3', 'mkv', 'mka', 'ogg', 'opus', 'flac', 'm4a', 'mp4', 'm4v', 'mov'])

// yt-dlp postprocessors that embed metadata/cover art/chapters all require ffmpeg.
// Returns [] when ffmpeg is absent so the download still succeeds (just without tags).
// Text metadata + chapters embed into any container; thumbnail is gated on `ext`
// (omit ext for playlist downloads where we select an m4a-preferring format).
export function metadataArgs(hasFfmpeg: boolean, ext?: string): string[] {
  if (!hasFfmpeg) return []
  const args = ['--embed-metadata', '--embed-chapters']
  if (ext === undefined || THUMBNAIL_EXTS.has(ext.toLowerCase())) {
    args.push('--embed-thumbnail')
  }
  return args
}

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
