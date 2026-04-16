import { NextResponse } from 'next/server'
import path from 'path'
import { streamCommand, ensureOutputDir, parseProgress, parseDestination } from '@/lib/ytdlp'
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
        // yt-dlp emits the final merged path last; we retain the last detected path.
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
        const savedPath = detectedPath ?? path.join(outputDir, `${title}.${ext}`)
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
