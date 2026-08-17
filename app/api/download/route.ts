import { NextResponse } from 'next/server'
import path from 'path'
import { ensureOutputDir, runDownload, progressTemplateArgs, checkFfmpeg, metadataArgs, ffmpegLocationArgs, ytdlpArgs } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'
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

  if (!url || !isYouTubeUrl(url)) {
    return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 })
  }
  if (!formatId || !title || !ext) {
    return NextResponse.json({ error: 'Missing formatId, title, or ext' }, { status: 400 })
  }

  const outputDir = ensureOutputDir(requestedDir)
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s')
  const meta = [...ffmpegLocationArgs(), ...metadataArgs((await checkFfmpeg()).found, ext)]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: DownloadStreamLine) =>
        controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'))

      const args = await ytdlpArgs(
        '-f', formatId, url, '-o', outputTemplate, '--no-playlist',
        ...progressTemplateArgs(), ...meta,
      )

      try {
        const gen = runDownload(args)
        let step = await gen.next()
        while (!step.done) {
          send(step.value)
          step = await gen.next()
        }

        // A non-zero exit means the file is missing or truncated -- reporting
        // `done` here would show "Saved to ..." for a download that failed.
        const result = step.value
        if (result.code !== 0) {
          send({ type: 'error', message: result.errorMessage ?? `yt-dlp exited with code ${result.code}` })
          return
        }

        // Prefer the path yt-dlp reported; fall back to constructed path.
        send({ type: 'done', savedPath: result.savedPath ?? path.join(outputDir, `${title}.${ext}`) })
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
