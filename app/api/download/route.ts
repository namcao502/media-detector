import { NextResponse } from 'next/server'
import path from 'path'
import { ensureOutputDir, runDownload, progressTemplateArgs, checkFfmpeg, metadataArgs, ffmpegLocationArgs, ytdlpArgs, removeStrayThumbnail } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
import { downloadStem, rawStem, outputTemplateFor, sanitizeUserStem } from '@/lib/filename'
import type { DownloadStreamLine } from '@/types/media'

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const record = typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {}
  const url = typeof record.url === 'string' ? record.url : ''
  const formatId = typeof record.formatId === 'string' ? record.formatId : ''
  const title = typeof record.title === 'string' ? record.title : ''
  const ext = typeof record.ext === 'string' ? record.ext : ''
  const requestedDir = typeof record.outputDir === 'string' ? record.outputDir : undefined
  // Naming metadata for the fallback path only; yt-dlp builds the real filename.
  const artist = typeof record.artist === 'string' ? record.artist : null
  const track = typeof record.track === 'string' ? record.track : null
  const uploader = typeof record.channel === 'string' ? record.channel : null
  const cleanNames = record.cleanNames !== false

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }
  if (!formatId || !title || !ext) {
    return NextResponse.json({ error: 'Missing formatId, title, or ext' }, { status: 400 })
  }

  const outputDir = ensureOutputDir(requestedDir)
  // The name is decided here, not by a yt-dlp template, so the preview the user
  // saw and the file on disk are produced by the same function.
  const source = { title, track, artist, uploader }
  // A name typed in the preview wins, once sanitized -- it is untrusted input
  // being pasted into an absolute path.
  const stem = sanitizeUserStem(record.filename)
    ?? (cleanNames ? downloadStem(source) : rawStem(source))
  const outputTemplate = outputTemplateFor(path.join(outputDir, stem))
  const meta = [...ffmpegLocationArgs(), ...metadataArgs((await checkFfmpeg()).found, ext)]

  // Cancellation: the client aborts its fetch, which aborts req.signal (and/or
  // cancels the stream). Both feed one controller that kills the yt-dlp process
  // tree -- otherwise the download would keep running after the user stopped it.
  const abort = new AbortController()
  const cancel = () => abort.abort()
  if (req.signal.aborted) cancel()
  else req.signal.addEventListener('abort', cancel, { once: true })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Enqueueing onto a controller the client already dropped throws; the run
      // is being torn down anyway, so swallow it.
      const send = (msg: DownloadStreamLine) => {
        if (abort.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))
        } catch {
          cancel()
        }
      }

      const args = await ytdlpArgs(
        '-f', formatId, url, '-o', outputTemplate, '--no-playlist',
        ...progressTemplateArgs(), ...meta,
      )

      try {
        const gen = runDownload(args, abort.signal)
        let step = await gen.next()
        while (!step.done) {
          send(step.value)
          step = await gen.next()
        }

        // A non-zero exit means the file is missing or truncated -- reporting
        // `done` here would show "Saved to ..." for a download that failed. A
        // cancelled run also exits non-zero, but the client is already gone.
        const result = step.value
        if (result.code !== 0) {
          // The embed step never ran, so the cover art it would have consumed
          // is still sitting next to the media file.
          removeStrayThumbnail(result.thumbnailPath)
          send({ type: 'error', message: result.errorMessage ?? `yt-dlp exited with code ${result.code}` })
          return
        }

        // Prefer the path yt-dlp reported; otherwise the name we gave it, which
        // it used verbatim.
        send({ type: 'done', savedPath: result.savedPath ?? path.join(outputDir, `${stem}.${ext}`) })
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

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
