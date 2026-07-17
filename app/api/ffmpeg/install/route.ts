import { streamCommand, execCommand } from '@/lib/ytdlp'

// Installs ffmpeg (which bundles ffprobe) via a package manager. Prefers winget
// (user-scope, no admin), falls back to Chocolatey. Streams progress as plain text.
export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (line: string) => controller.enqueue(encoder.encode(line + '\n'))
      try {
        const hasWinget = (await execCommand('winget --version')).code === 0
        const hasChoco = !hasWinget && (await execCommand('choco --version')).code === 0

        let args: string[] | null = null
        if (hasWinget) {
          emit('Installing ffmpeg via winget (Gyan.FFmpeg)...')
          args = [
            'winget', 'install', '--id', 'Gyan.FFmpeg', '-e',
            '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity',
          ]
        } else if (hasChoco) {
          emit('Installing ffmpeg via Chocolatey...')
          args = ['choco', 'install', 'ffmpeg', '-y']
        } else {
          emit('Neither winget nor Chocolatey was found.')
          emit('Install ffmpeg manually from https://www.gyan.dev/ffmpeg/builds/')
          emit('(or drop ffmpeg.exe + ffprobe.exe into the app\'s bin/ folder).')
        }

        if (args) {
          for await (const line of streamCommand(args)) emit(line)
          emit('Done. If the ffmpeg row stays red, restart the dev server to pick it up.')
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
