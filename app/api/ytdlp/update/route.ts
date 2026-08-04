import { streamCommand, pipArgs } from '@/lib/ytdlp'

export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // yt-dlp -U self-update refuses for pip/PyPI installs; update the way it was installed.
        // mutagen embeds cover art into mp4/m4a; without it yt-dlp's ffmpeg fallback fails.
        for await (const line of streamCommand(await pipArgs('install', '--upgrade', 'yt-dlp', 'mutagen'))) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
