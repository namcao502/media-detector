import { exec as nodeExec, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type {
  MediaInfo, VideoFormat, AudioFormat, PlaylistInfo, PlaylistDownloadLine, PlaylistFormatSelection,
  DownloadProgressLine, DownloadPhase, DownloadPhaseLine,
} from '@/types/media'

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

// Args every YouTube call needs to get a format URL that is not HTTP 403.
//
// 1. JS challenges. YouTube's player gates its format URLs behind signature and
//    "n" challenges that yt-dlp can only answer with an external JavaScript
//    runtime plus the EJS solver script. Miss either and the download dies with
//    "unable to download video data: HTTP Error 403: Forbidden" -- after the
//    cover art has already been written, which is why a failed run used to leave
//    a lone .webp behind. We are already running on Node, so hand yt-dlp this
//    process's own binary rather than hoping deno is installed. The solver
//    script is fetched once from the yt-dlp org's release and cached under
//    yt-dlp's cache dir; without --remote-components it is skipped and the
//    challenges fail even with a runtime present.
// 2. Player client. yt-dlp's default client (android_vr) needs no PO token, but
//    its URLs currently 403 on every video (yt-dlp#17456). web_embedded needs no
//    token either and serves the same audio-only + DASH formats, so ask for it
//    first and keep the defaults behind it for videos that disable embedding.
export function youtubeAccessArgs(): string[] {
  return [
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--extractor-args', 'youtube:player_client=web_embedded,default',
  ]
}

// yt-dlp installs a `yt-dlp` shim into Python's Scripts dir, which a fresh
// python.org install does not add to PATH. Run it as a module so it works
// wherever `python` does.
export async function ytdlpArgs(...args: string[]): Promise<string[]> {
  return [await resolvePython(), '-m', 'yt_dlp', ...youtubeAccessArgs(), ...args]
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

// Fields requested from yt-dlp's --progress-template, in emission order. Raw
// numbers (bytes, bytes/s, seconds) rather than yt-dlp's human-readable
// "1.23MiB/s" text, so the UI formats them itself and never parses units.
const PROGRESS_FIELDS = [
  'downloaded_bytes',
  'total_bytes',
  'total_bytes_estimate',
  'speed',
  'eta',
  'fragment_index',
  'fragment_count',
] as const

// Marker that distinguishes our template line from yt-dlp's other output.
const PROGRESS_PREFIX = '@PROG'

// --progress-template replaces the default `[download]  42.3% of ...` line with
// the machine-readable form above; --newline keeps each update on its own line
// instead of overwriting with \r (which streamCommand/runTrack cannot split).
export function progressTemplateArgs(): string[] {
  const template = PROGRESS_FIELDS.map((f) => `%(progress.${f})s`).join(' ')
  return ['--newline', '--progress-template', `download:${PROGRESS_PREFIX} ${template}`]
}

// yt-dlp renders an unset field as the literal "NA".
function parseNumberField(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === 'NA' || raw === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

// Parses one progress update. Handles our --progress-template line first, and
// falls back to yt-dlp's default human-readable line so a percentage still shows
// if the template is ever dropped from the args.
export function parseProgressLine(line: string): DownloadProgressLine | null {
  if (line.startsWith(PROGRESS_PREFIX)) {
    const parts = line.slice(PROGRESS_PREFIX.length).trim().split(/\s+/)
    const [downloaded, total, estimate, speed, eta, fragIndex, fragCount] = parts
    const downloadedBytes = parseNumberField(downloaded)
    // Fragmented (DASH/HLS) downloads only know an estimate.
    const totalBytes = parseNumberField(total) ?? parseNumberField(estimate)
    const percent =
      downloadedBytes !== undefined && totalBytes !== undefined && totalBytes > 0
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10)
        : 0
    return {
      type: 'progress',
      percent,
      downloadedBytes,
      totalBytes,
      speedBytesPerSec: parseNumberField(speed),
      etaSeconds: parseNumberField(eta),
      fragmentIndex: parseNumberField(fragIndex),
      fragmentCount: parseNumberField(fragCount),
    }
  }

  const match = line.match(/\[download\]\s+([\d.]+)%/)
  if (!match) return null
  return { type: 'progress', percent: parseFloat(match[1]) }
}

// Which yt-dlp stage a line came from. The ffmpeg-backed postprocessors print a
// single line when they start and nothing until they finish, so this label is
// the only signal that a stalled-looking bar is actually still working.
const PHASE_RULES: { pattern: RegExp; phase: DownloadPhase; label: string }[] = [
  { pattern: /^\[download\] Destination:/, phase: 'downloading', label: 'Downloading' },
  { pattern: /^\[Merger\]/, phase: 'merging', label: 'Merging video and audio' },
  { pattern: /^\[(ExtractAudio|VideoConvertor|VideoRemuxer)\]/, phase: 'converting', label: 'Converting with ffmpeg' },
  // yt-dlp's FixupM4a/FixupStretched/... postprocessors, also ffmpeg-backed.
  { pattern: /^\[Fixup\w*\]/, phase: 'converting', label: 'Repairing container' },
  { pattern: /^\[(Metadata|EmbedThumbnail|ThumbnailsConvertor|EmbedSubtitle)\]/, phase: 'embedding', label: 'Embedding metadata and cover art' },
  { pattern: /^\[MoveFiles\]|^Deleting original file/, phase: 'finishing', label: 'Finishing up' },
  { pattern: /^\[(info|generic|youtube(:\w+)?)\]/, phase: 'extracting', label: 'Reading video page' },
]

export function parsePhase(line: string): DownloadPhaseLine | null {
  for (const rule of PHASE_RULES) {
    if (rule.pattern.test(line)) return { type: 'phase', phase: rule.phase, label: rule.label }
  }
  return null
}

// yt-dlp downloads the cover art to a sibling file and deletes it once the
// embed postprocessor has run. A download that fails or is cancelled never
// reaches that step, orphaning the image next to the media. Neither --paths nor
// `-o thumbnail:` redirects it (verified), so the path is captured here and the
// file removed on a non-zero exit.
export function parseThumbnailPath(line: string): string | null {
  const match = line.match(/^\[info\]\s+Writing\s+\w+\s+thumbnail(?:\s+\S+)?\s+to:\s*(.+)$/)
  return match ? match[1].trim() : null
}

// Best-effort: a thumbnail we could not delete is untidy, never fatal.
export function removeStrayThumbnail(thumbnailPath: string | undefined): void {
  if (!thumbnailPath) return
  try {
    fs.rmSync(thumbnailPath, { force: true })
  } catch {
    // file already gone, or locked by another process
  }
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
    artist: raw.artist ?? null,
    track: raw.track ?? null,
    videoFormats,
    audioFormats,
  }
}

export function resolveOutputDir(): string {
  const documentsDir = path.join(os.homedir(), 'Documents')
  return path.join(documentsDir, 'MediaDetector')
}

// Uses `customDir` when it is a non-empty absolute path (the validation boundary
// for the user-supplied folder); otherwise falls back to the default location.
// User input only reaches yt-dlp via ytdlpArgs -> spawn, so it is injection-safe.
export function ensureOutputDir(customDir?: string): string {
  const dir = customDir && path.isAbsolute(customDir) ? customDir : resolveOutputDir()
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

// Builds the yt-dlp format args for a playlist download plus the container ext the
// output will have. `expectedExt` feeds metadataArgs so --embed-thumbnail is only
// requested for containers that can hold it (webm cannot -> avoids the embed error
// and the stray .webp left beside the audio). Pure -- unit-testable without spawning.
export function playlistFormatArgs(
  sel: PlaylistFormatSelection,
  hasFfmpeg: boolean,
): { formatArgs: string[]; expectedExt: string } {
  if (sel.mode === 'video') {
    const q = sel.videoQuality ?? '1080'
    // Prefer mp4 (h264+aac) so every file is a consistent, thumbnail-embeddable .mp4.
    const cap = q === 'best' ? '' : `[height<=${q}]`
    const selector =
      q === 'best'
        ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        : `bestvideo${cap}[ext=mp4]+bestaudio[ext=m4a]/best${cap}[ext=mp4]/best${cap}`
    return { formatArgs: ['-f', selector, '--merge-output-format', 'mp4'], expectedExt: 'mp4' }
  }

  // Always pick the source that needs the least conversion. YouTube's plain
  // `bestaudio` is opus-in-webm, so asking for m4a without a selector made
  // ffmpeg transcode every track: measured at 27s vs 0.4s for a 37-minute file,
  // with no output while it ran, which looked exactly like a hang.
  // The stereo clause matters too: plain `bestaudio[ext=m4a]` picks the 5.1
  // surround AAC track where one exists (format 258, 388kbps vs 140's 129kbps),
  // which is 3x the bytes for something headed to a phone.
  const M4A_SOURCE =
    'bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best'

  const fmt = sel.audioFormat ?? 'm4a'
  if (fmt === 'mp3') {
    // mp3 is a re-encode whatever the source; starting from AAC is no slower
    // than from opus and avoids a needless second generation loss.
    return { formatArgs: ['-f', M4A_SOURCE, '-x', '--audio-format', 'mp3'], expectedExt: 'mp3' }
  }
  if (fmt === 'best') {
    // Native audio, no conversion. Typically opus-in-webm -> report webm so no
    // thumbnail is requested (webm cannot embed one).
    return { formatArgs: ['-f', 'bestaudio/best'], expectedExt: 'webm' }
  }
  // m4a: prefer an AAC source so --audio-format m4a is a lossless remux rather
  // than a transcode. Without ffmpeg there is no postprocessing at all.
  if (hasFfmpeg) {
    return { formatArgs: ['-f', M4A_SOURCE, '-x', '--audio-format', 'm4a'], expectedExt: 'm4a' }
  }
  return { formatArgs: ['-f', M4A_SOURCE], expectedExt: 'm4a' }
}

export function parsePlaylistInfo(jsonStr: string): PlaylistInfo {
  const raw = JSON.parse(jsonStr)
  interface RawEntry {
    title?: string | null
    uploader?: string | null
    channel?: string | null
  }
  const entries: Array<RawEntry | null> = raw.entries ?? []
  const tracks = entries.map((e, i) => ({
    index: i + 1,
    title: e?.title ?? `Track ${i + 1}`,
    author: e?.uploader ?? e?.channel ?? null,
  }))
  return { title: raw.title ?? 'Playlist', count: tracks.length, tracks }
}

export interface PlaylistEntry {
  id: string
  title: string
  // Per-entry channel, used to strip a duplicated author prefix from the title.
  // A flat dump carries no music `artist` field, only the uploading channel.
  author: string | null
}

// Parses `--flat-playlist --dump-single-json` output into the playlist title and
// each entry's video id + title. Sibling of parsePlaylistInfo (used by detect);
// this one also keeps the id so tracks can be downloaded one at a time.
export function parsePlaylistEntries(jsonStr: string): { title: string; entries: PlaylistEntry[] } {
  const raw = JSON.parse(jsonStr)
  interface RawEntry {
    id?: string | null
    title?: string | null
    uploader?: string | null
    channel?: string | null
  }
  const rawEntries: Array<RawEntry | null> = raw.entries ?? []
  const entries = rawEntries
    .filter((e): e is RawEntry => e !== null && typeof e.id === 'string')
    .map((e, i) => ({
      id: e.id as string,
      title: e.title ?? `Track ${i + 1}`,
      author: e.uploader ?? e.channel ?? null,
    }))
  return { title: raw.title ?? 'Playlist', entries }
}

// Sanitizes a playlist title into a safe folder name. Single-video downloads do
// not populate %(playlist_title)s, so this is injected literally into the path.
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- strip filesystem-illegal + control chars
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned || 'Playlist'
}

// Kills a spawned download and everything it started. yt-dlp runs ffmpeg as a
// child, and on Windows `proc.kill()` only reaps the direct child -- the encoder
// would keep running and holding the output file open -- so shell out to taskkill
// with /T. On macOS yt-dlp handles SIGTERM and tears its own children down.
export function killProcessTree(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    killer.on('error', () => { proc.kill() })
    return
  }
  proc.kill('SIGTERM')
}

// How long a run may produce no output at all before it is treated as hung.
// ffmpeg postprocessing is silent by design -- yt-dlp swallows its output -- so
// a deadline is the only way to tell "still working" from "stuck". Generous
// enough for a slow postprocess on a long track, but bounded: without it one
// wedged track stalls a whole playlist indefinitely.
export const IDLE_TIMEOUT_MS = 5 * 60_000

// Marks the error line a timeout produces. A hang is not a flaky network, so
// callers use this to stop retrying instead of burning the deadline again.
export const HUNG_MARKER = 'treating the download as hung'

// Runs a single yt-dlp download, yielding merged stdout+stderr lines; the async
// generator's RETURN value is the process exit code (0 = success). Like
// streamCommand, but surfaces the code so callers can tell success from failure.
// Aborting `signal` kills the process tree, which ends the stream naturally with
// a non-zero code; so does going quiet for longer than `idleTimeoutMs` (pass 0
// to disable).
export async function* runTrack(
  args: string[],
  signal?: AbortSignal,
  idleTimeoutMs: number = IDLE_TIMEOUT_MS,
): AsyncGenerator<string, number> {
  const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
  const buffer: string[] = []
  let notify: (() => void) | null = null
  let closed = false
  let exitCode = 1

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const clearIdleTimer = () => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = null
  }

  const push = (line: string) => { buffer.push(line); notify?.() }

  // Re-armed on every line, so the deadline is on silence, not total runtime.
  const armIdleTimer = () => {
    if (idleTimeoutMs <= 0 || timedOut) return
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      timedOut = true
      push(`ERROR: no output for ${Math.round(idleTimeoutMs / 1000)}s -- ${HUNG_MARKER}`)
      killProcessTree(proc)
    }, idleTimeoutMs)
  }

  const onData = (chunk: Buffer) => {
    armIdleTimer()
    chunk.toString('utf8').split('\n').filter(Boolean).forEach(push)
  }

  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('error', (err: Error) => { push(`ERROR: ${err.message}`); exitCode = 1; closed = true; clearIdleTimer(); notify?.() })
  proc.on('close', (code) => { exitCode = code ?? 1; closed = true; clearIdleTimer(); notify?.() })

  const onAbort = () => killProcessTree(proc)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  armIdleTimer()

  try {
    while (!closed || buffer.length > 0) {
      if (buffer.length > 0) {
        yield buffer.shift()!
      } else {
        await new Promise<void>((r) => { notify = r })
        notify = null
      }
    }
  } finally {
    // Covers the abandoned-generator case too: if the caller stops pulling and
    // the generator is collected, this still stops yt-dlp.
    clearIdleTimer()
    signal?.removeEventListener('abort', onAbort)
    killProcessTree(proc)
  }

  return exitCode
}

export interface DownloadRunResult {
  code: number
  savedPath?: string
  errorMessage?: string
  // Cover art yt-dlp wrote alongside the media; only still on disk if the run
  // did not reach the embed step. See removeStrayThumbnail.
  thumbnailPath?: string
}

// Translates raw yt-dlp output into UI stream lines: a progress update per
// template line, a phase line whenever the stage changes (never repeated), and
// the final path/exit code/error text as the return value. The source generator
// is injected, so this is unit-testable without spawning.
export async function* translateDownloadLines(
  gen: AsyncGenerator<string, number>,
): AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, DownloadRunResult> {
  let savedPath: string | undefined
  let thumbnailPath: string | undefined
  let lastPhase: DownloadPhase | null = null
  const errors: string[] = []

  let step = await gen.next()
  while (!step.done) {
    const line = step.value
    const progress = parseProgressLine(line)
    if (progress) yield progress

    const phase = parsePhase(line)
    if (phase && phase.phase !== lastPhase) {
      lastPhase = phase.phase
      yield phase
    }

    const dest = parseDestination(line)
    if (dest) savedPath = dest

    const thumb = parseThumbnailPath(line)
    if (thumb) thumbnailPath = thumb

    if (/^ERROR:/i.test(line)) errors.push(line.replace(/^ERROR:\s*/i, '').trim())
    step = await gen.next()
  }

  return {
    code: step.value,
    savedPath,
    thumbnailPath,
    errorMessage: errors.length !== 0 ? errors.join(' ') : undefined,
  }
}

// Spawns one yt-dlp download and streams it as UI lines. Shared by the
// single-video route and the per-track playlist downloader. Aborting `signal`
// kills the download.
export function runDownload(
  args: string[],
  signal?: AbortSignal,
): AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, DownloadRunResult> {
  return translateDownloadLines(runTrack(args, signal))
}

export interface TrackOutcome {
  ok: boolean
  savedPath?: string
  // The attempt was killed by the idle deadline rather than failing outright.
  // Retrying would just burn the deadline again, so the engine gives up early.
  hung?: boolean
}

// Downloads one track (attempt is 1-based); yields progress/phase lines that are
// passed straight through to the client, returns the outcome.
export interface TrackJob {
  id: string
  title: string
  index: number
  author?: string | null
}

export type TrackDownloader = (
  track: TrackJob,
  attempt: number,
) => AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, TrackOutcome>

export interface OrchestrateOptions {
  attemptsPerPhase: number
  folder: string // absolute destination folder, echoed in the final `done` line
  backoffMs: number
  sleep: (ms: number) => Promise<void>
  // When aborted the batch stops at the current track: no further retries, no
  // phase-2 sweep. Without this a cancelled track would look like a failure and
  // be retried up to 10 more times after the user asked to stop.
  signal?: AbortSignal
}

// Two-phase per-track retry engine. Phase 1 tries each track up to attemptsPerPhase,
// skipping (queuing) failures so the batch continues. Phase 2 re-sweeps the skipped
// tracks up to attemptsPerPhase; any still failing are marked `track-error`. Pure --
// the download and sleep are injected, so it is unit-testable without spawning yt-dlp.
export async function* orchestratePlaylist(
  tracks: TrackJob[],
  download: TrackDownloader,
  opts: OrchestrateOptions,
): AsyncGenerator<PlaylistDownloadLine> {
  const total = tracks.length
  let downloaded = 0

  async function* attemptTrack(
    track: TrackJob,
    phase: 1 | 2,
  ): AsyncGenerator<PlaylistDownloadLine, TrackOutcome> {
    let outcome: TrackOutcome = { ok: false }
    for (let attempt = 1; attempt <= opts.attemptsPerPhase; attempt++) {
      const gen = download(track, attempt)
      let step = await gen.next()
      while (!step.done) {
        yield step.value
        step = await gen.next()
      }
      outcome = step.value
      if (outcome.ok) return outcome
      // A cancelled track exits non-zero like a failed one; without this check
      // the engine would keep retrying work the user just stopped.
      if (opts.signal?.aborted) return outcome
      // Likewise a hang: 5 more attempts would cost 5 more deadlines.
      if (outcome.hung) return outcome
      if (attempt < opts.attemptsPerPhase) {
        yield { type: 'track-retry', index: track.index, attempt, phase }
        await opts.sleep(opts.backoffMs)
      }
    }
    return outcome
  }

  const skipped: TrackJob[] = []
  for (const track of tracks) {
    if (opts.signal?.aborted) break
    yield { type: 'item', index: track.index, total }
    const outcome = yield* attemptTrack(track, 1)
    if (outcome.ok) {
      downloaded += 1
      yield { type: 'track-done', index: track.index, savedPath: outcome.savedPath ?? '' }
    } else if (!opts.signal?.aborted) {
      yield { type: 'track-skipped', index: track.index }
      skipped.push(track)
    }
  }

  for (const track of skipped) {
    if (opts.signal?.aborted) break
    yield { type: 'item', index: track.index, total }
    const outcome = yield* attemptTrack(track, 2)
    if (outcome.ok) {
      downloaded += 1
      yield { type: 'track-done', index: track.index, savedPath: outcome.savedPath ?? '' }
    } else if (!opts.signal?.aborted) {
      yield { type: 'track-error', index: track.index, title: track.title }
    }
  }

  yield {
    type: 'done',
    folder: opts.folder,
    downloaded,
    total,
    failed: total - downloaded,
    cancelled: opts.signal?.aborted === true,
  }
}
