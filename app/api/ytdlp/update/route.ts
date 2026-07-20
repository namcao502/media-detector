import { pipStream } from '@/lib/ytdlp'

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // yt-dlp -U self-update refuses for pip/PyPI installs; update the way it was installed.
        for await (const line of pipStream('install', '--upgrade', 'yt-dlp')) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
