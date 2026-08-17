import { NextResponse } from 'next/server'
import path from 'path'
import {
  execArgs, ensureOutputDir, checkFfmpeg, metadataArgs, ffmpegLocationArgs, ytdlpArgs,
  playlistFormatArgs, parsePlaylistEntries, sanitizeFolderName, orchestratePlaylist,
  runDownload, progressTemplateArgs,
} from '@/lib/ytdlp'
import type { TrackDownloader } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
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

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }

  const outputDir = ensureOutputDir(requestedDir)
  const hasFfmpeg = (await checkFfmpeg()).found
  const { formatArgs, expectedExt } = playlistFormatArgs(parseSelection(record), hasFfmpeg)
  const meta = [...ffmpegLocationArgs(), ...metadataArgs(hasFfmpeg, expectedExt)]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: PlaylistDownloadLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
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
        const outputTemplate = path.join(folder, '%(title)s.%(ext)s')

        // Downloads one track as its own yt-dlp process. formatArgs encodes the
        // chosen preset; metadataArgs embeds tags/cover art when the container allows.
        const download: TrackDownloader = async function* (track) {
          const videoUrl = `https://www.youtube.com/watch?v=${track.id}`
          const args = await ytdlpArgs(
            ...formatArgs, '--no-playlist', videoUrl, '-o', outputTemplate,
            ...progressTemplateArgs(), ...meta,
          )
          const gen = runDownload(args)
          let step = await gen.next()
          while (!step.done) {
            yield step.value
            step = await gen.next()
          }
          return { ok: step.value.code === 0, savedPath: step.value.savedPath }
        }

        const tracks = entries.map((e, i) => ({ ...e, index: i + 1 }))
        for await (const line of orchestratePlaylist(tracks, download, {
          attemptsPerPhase: ATTEMPTS_PER_PHASE,
          folder,
          backoffMs: RETRY_BACKOFF_MS,
          sleep,
        })) {
          send(line)
        }
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })
}
