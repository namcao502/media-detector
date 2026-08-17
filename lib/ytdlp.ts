import { exec as nodeExec, spawn } from 'child_process'
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

  const fmt = sel.audioFormat ?? 'm4a'
  if (fmt === 'mp3') {
    // Re-encode to mp3 (requires ffmpeg); the UI disables this when ffmpeg is absent.
    return { formatArgs: ['-x', '--audio-format', 'mp3'], expectedExt: 'mp3' }
  }
  if (fmt === 'best') {
    // Native audio, no conversion. Typically opus-in-webm -> report webm so no
    // thumbnail is requested (webm cannot embed one).
    return { formatArgs: ['-f', 'bestaudio/best'], expectedExt: 'webm' }
  }
  // m4a: with ffmpeg, extract to m4a so every track is a consistent .m4a (remux,
  // lossless when the source is already AAC). Without ffmpeg, best-effort selection.
  if (hasFfmpeg) {
    return { formatArgs: ['-x', '--audio-format', 'm4a'], expectedExt: 'm4a' }
  }
  return { formatArgs: ['-f', 'bestaudio[ext=m4a]/bestaudio/best'], expectedExt: 'm4a' }
}

export function parsePlaylistInfo(jsonStr: string): PlaylistInfo {
  const raw = JSON.parse(jsonStr)
  const entries: Array<{ title?: string | null } | null> = raw.entries ?? []
  const tracks = entries.map((e, i) => ({ index: i + 1, title: e?.title ?? `Track ${i + 1}` }))
  return { title: raw.title ?? 'Playlist', count: tracks.length, tracks }
}

// Parses `--flat-playlist --dump-single-json` output into the playlist title and
// each entry's video id + title. Sibling of parsePlaylistInfo (used by detect);
// this one also keeps the id so tracks can be downloaded one at a time.
export function parsePlaylistEntries(jsonStr: string): { title: string; entries: { id: string; title: string }[] } {
  const raw = JSON.parse(jsonStr)
  const rawEntries: Array<{ id?: string | null; title?: string | null } | null> = raw.entries ?? []
  const entries = rawEntries
    .filter((e): e is { id?: string | null; title?: string | null } => e !== null && typeof e.id === 'string')
    .map((e, i) => ({ id: e.id as string, title: e.title ?? `Track ${i + 1}` }))
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

// Runs a single yt-dlp download, yielding merged stdout+stderr lines; the async
// generator's RETURN value is the process exit code (0 = success). Like
// streamCommand, but surfaces the code so callers can tell success from failure.
export async function* runTrack(args: string[]): AsyncGenerator<string, number> {
  const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
  const buffer: string[] = []
  let notify: (() => void) | null = null
  let closed = false
  let exitCode = 1

  const push = (line: string) => { buffer.push(line); notify?.() }
  proc.stdout.on('data', (c: Buffer) => c.toString('utf8').split('\n').filter(Boolean).forEach(push))
  proc.stderr.on('data', (c: Buffer) => c.toString('utf8').split('\n').filter(Boolean).forEach(push))
  proc.on('error', (err: Error) => { push(`ERROR: ${err.message}`); exitCode = 1; closed = true; notify?.() })
  proc.on('close', (code) => { exitCode = code ?? 1; closed = true; notify?.() })

  while (!closed || buffer.length > 0) {
    if (buffer.length > 0) {
      yield buffer.shift()!
    } else {
      await new Promise<void>((r) => { notify = r })
      notify = null
    }
  }
  return exitCode
}

export interface DownloadRunResult {
  code: number
  savedPath?: string
  errorMessage?: string
}

// Translates raw yt-dlp output into UI stream lines: a progress update per
// template line, a phase line whenever the stage changes (never repeated), and
// the final path/exit code/error text as the return value. The source generator
// is injected, so this is unit-testable without spawning.
export async function* translateDownloadLines(
  gen: AsyncGenerator<string, number>,
): AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, DownloadRunResult> {
  let savedPath: string | undefined
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

    if (/^ERROR:/i.test(line)) errors.push(line.replace(/^ERROR:\s*/i, '').trim())
    step = await gen.next()
  }

  return {
    code: step.value,
    savedPath,
    errorMessage: errors.length !== 0 ? errors.join(' ') : undefined,
  }
}

// Spawns one yt-dlp download and streams it as UI lines. Shared by the
// single-video route and the per-track playlist downloader.
export function runDownload(
  args: string[],
): AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, DownloadRunResult> {
  return translateDownloadLines(runTrack(args))
}

export interface TrackOutcome {
  ok: boolean
  savedPath?: string
}

// Downloads one track (attempt is 1-based); yields progress/phase lines that are
// passed straight through to the client, returns the outcome.
export type TrackDownloader = (
  track: { id: string; title: string; index: number },
  attempt: number,
) => AsyncGenerator<DownloadProgressLine | DownloadPhaseLine, TrackOutcome>

export interface OrchestrateOptions {
  attemptsPerPhase: number
  folder: string // absolute destination folder, echoed in the final `done` line
  backoffMs: number
  sleep: (ms: number) => Promise<void>
}

// Two-phase per-track retry engine. Phase 1 tries each track up to attemptsPerPhase,
// skipping (queuing) failures so the batch continues. Phase 2 re-sweeps the skipped
// tracks up to attemptsPerPhase; any still failing are marked `track-error`. Pure --
// the download and sleep are injected, so it is unit-testable without spawning yt-dlp.
export async function* orchestratePlaylist(
  tracks: { id: string; title: string; index: number }[],
  download: TrackDownloader,
  opts: OrchestrateOptions,
): AsyncGenerator<PlaylistDownloadLine> {
  const total = tracks.length
  let downloaded = 0

  async function* attemptTrack(
    track: { id: string; title: string; index: number },
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
      if (attempt < opts.attemptsPerPhase) {
        yield { type: 'track-retry', index: track.index, attempt, phase }
        await opts.sleep(opts.backoffMs)
      }
    }
    return outcome
  }

  const skipped: { id: string; title: string; index: number }[] = []
  for (const track of tracks) {
    yield { type: 'item', index: track.index, total }
    const outcome = yield* attemptTrack(track, 1)
    if (outcome.ok) {
      downloaded += 1
      yield { type: 'track-done', index: track.index, savedPath: outcome.savedPath ?? '' }
    } else {
      yield { type: 'track-skipped', index: track.index }
      skipped.push(track)
    }
  }

  for (const track of skipped) {
    yield { type: 'item', index: track.index, total }
    const outcome = yield* attemptTrack(track, 2)
    if (outcome.ok) {
      downloaded += 1
      yield { type: 'track-done', index: track.index, savedPath: outcome.savedPath ?? '' }
    } else {
      yield { type: 'track-error', index: track.index, title: track.title }
    }
  }

  yield { type: 'done', folder: opts.folder, downloaded, total, failed: total - downloaded }
}
