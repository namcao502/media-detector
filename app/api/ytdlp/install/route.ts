import { streamCommand, pipArgs } from '@/lib/ytdlp'

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const line of streamCommand(await pipArgs('install', 'yt-dlp'))) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
