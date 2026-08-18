import { NextResponse } from 'next/server'
import path from 'path'
import {
  execArgs, ensureOutputDir, checkFfmpeg, metadataArgs, ffmpegLocationArgs, ytdlpArgs,
  playlistFormatArgs, parsePlaylistEntries, sanitizeFolderName, orchestratePlaylist,
  runDownload, progressTemplateArgs, removeStrayThumbnail, HUNG_MARKER,
} from '@/lib/ytdlp'
import type { TrackDownloader } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
import { downloadStem, rawStem, outputTemplateFor, sanitizeUserStem } from '@/lib/filename'
import type { PlaylistDownloadLine, PlaylistFormatSelection, PlaylistFormatMode, PlaylistAudioFormat, PlaylistVideoQuality } from '@/types/media'

const ATTEMPTS_PER_PHASE = 5
const RETRY_BACKOFF_MS = 1000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Parses the format selection from the request body, ignoring unknown values.
function parseSelection(record: Record<string, unknown>): PlaylistFormatSelection {
  const mode: PlaylistFormatMode = record.mode === 'video' ? 'video' : 'audio'
  const af = record.audioFormat
  const audioFormat: PlaylistAudioFormat =
    af === 'mp3' || af === 'best' ? af : 'm4a'
  const vq = record.videoQuality
  const videoQuality: PlaylistVideoQuality =
    vq === '720' || vq === 'best' ? vq : '1080'
  return { mode, audioFormat, videoQuality }
}

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const record = typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {}
  const url = typeof record.url === 'string' ? record.url : ''
  const requestedDir = typeof record.outputDir === 'string' ? record.outputDir : undefined
  const cleanNames = record.cleanNames !== false
  // Filenames typed per track in the preview, keyed by 1-based track index.
  const customNames = typeof record.names === 'object' && record.names !== null
    ? (record.names as Record<string, unknown>)
    : {}

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }

  const outputDir = ensureOutputDir(requestedDir)
  const hasFfmpeg = (await checkFfmpeg()).found
  const { formatArgs, expectedExt } = playlistFormatArgs(parseSelection(record), hasFfmpeg)
  const meta = [...ffmpegLocationArgs(), ...metadataArgs(hasFfmpeg, expectedExt)]

  // Cancellation: the client aborts its fetch, which aborts req.signal (and/or
  // cancels the stream). Both feed one controller that kills the running track's
  // process tree and stops the retry engine from sweeping the rest.
  const abort = new AbortController()
  const cancel = () => abort.abort()
  if (req.signal.aborted) cancel()
  else req.signal.addEventListener('abort', cancel, { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Enqueueing onto a controller the client already dropped throws; the run
      // is being torn down anyway, so swallow it.
      const send = (msg: PlaylistDownloadLine) => {
        if (abort.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
        } catch {
          cancel()
        }
      }
      try {
        // Fetch the track list first so each video can be downloaded (and retried)
        // as its own process. --flat-playlist avoids probing every video's formats.
        const dump = await execArgs(await ytdlpArgs('--flat-playlist', '--dump-single-json', '--yes-playlist', url))
        if (dump.code !== 0 || !dump.stdout) {
          send({ type: 'error', message: dump.stderr.replace(/^ERROR:\s*/i, '') || 'Failed to fetch playlist' })
          return
        }
        const { title, entries } = parsePlaylistEntries(dump.stdout)
        if (entries.length === 0) {
          send({ type: 'error', message: 'Playlist has no downloadable tracks' })
          return
        }

        const folder = path.join(outputDir, sanitizeFolderName(title))

        // Downloads one track as its own yt-dlp process. formatArgs encodes the
        // chosen preset; metadataArgs embeds tags/cover art when the container allows.
        const download: TrackDownloader = async function* (track) {
          const videoUrl = `https://www.youtube.com/watch?v=${track.id}`
          // Named per track from the flat-dump metadata, so the name is fixed
          // before yt-dlp runs and stays identical on a re-run (which is what
          // lets yt-dlp skip tracks it already has).
          const source = { title: track.title, uploader: track.author }
          // A name typed in the preview wins, once sanitized -- it is untrusted
          // input being pasted into an absolute path.
          const stem = sanitizeUserStem(customNames[String(track.index)])
            ?? (cleanNames ? downloadStem(source) : rawStem(source))
          const args = await ytdlpArgs(
            ...formatArgs, '--no-playlist', videoUrl,
            '-o', outputTemplateFor(path.join(folder, stem)),
            ...progressTemplateArgs(), ...meta,
          )
          const gen = runDownload(args, abort.signal)
          let step = await gen.next()
          while (!step.done) {
            yield step.value
            step = await gen.next()
          }
          // A failed or cancelled attempt leaves the cover art it never got to
          // embed next to the media; each retry would add another one.
          if (step.value.code !== 0) removeStrayThumbnail(step.value.thumbnailPath)
          return {
            ok: step.value.code === 0,
            savedPath: step.value.savedPath,
            hung: step.value.errorMessage?.includes(HUNG_MARKER) === true,
          }
        }

        const tracks = entries.map((e, i) => ({ ...e, index: i + 1 }))
        for await (const line of orchestratePlaylist(tracks, download, {
          attemptsPerPhase: ATTEMPTS_PER_PHASE,
          folder,
          backoffMs: RETRY_BACKOFF_MS,
          sleep,
          signal: abort.signal,
        })) {
          send(line)
        }
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        req.signal.removeEventListener('abort', cancel)
        try {
          controller.close()
        } catch {
          // already closed by the client disconnecting
        }
      }
    },
    cancel,
  })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}
