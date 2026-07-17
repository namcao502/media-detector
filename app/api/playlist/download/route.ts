import { NextResponse } from 'next/server'
import path from 'path'
import { streamCommand, ensureOutputDir, reducePlaylistLine, finalizePlaylist, initialPlaylistState, checkFfmpeg, metadataArgs, ffmpegLocationArgs } from '@/lib/ytdlp'
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
  const meta = [...ffmpegLocationArgs(), ...metadataArgs((await checkFfmpeg()).found)]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: PlaylistDownloadLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
      // Prefer m4a audio (no re-encode) so cover art can embed -- yt-dlp cannot
      // embed thumbnails into webm, which is what bare bestaudio (opus) returns.
      // Falls back to bestaudio/best when no m4a stream exists.
      // metadataArgs adds --embed-* only when ffmpeg is present.
      // --ignore-errors so one private/unavailable track does not abort the batch.
      const args = [
        'yt-dlp', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '--yes-playlist',
        url, '-o', outputTemplate, '--newline', '--ignore-errors', ...meta,
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
