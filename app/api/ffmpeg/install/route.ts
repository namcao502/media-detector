import { streamCommand, execCommand } from '@/lib/ytdlp'

// Installs ffmpeg (which bundles ffprobe) via a package manager. On Windows:
// winget (user-scope, no admin), falling back to Chocolatey. On Linux: apt-get
// when running as root, else prints the sudo command. Streams progress as plain text.
export async function POST(): Promise<Response> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (line: string) => controller.enqueue(encoder.encode(line + '\n'))
      try {
        let args: string[] | null = null

        if (process.platform === 'win32') {
          const hasWinget = (await execCommand('winget --version')).code === 0
          const hasChoco = !hasWinget && (await execCommand('choco --version')).code === 0
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
        } else if (process.platform === 'linux') {
          const hasApt = (await execCommand('apt-get --version')).code === 0
          const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
          if (hasApt && isRoot) {
            emit('Installing ffmpeg via apt-get...')
            args = ['apt-get', 'install', '-y', 'ffmpeg']
          } else {
            emit('Installing ffmpeg needs root. Run this in a terminal:')
            emit('  sudo apt install ffmpeg')
            emit("(or drop ffmpeg + ffprobe binaries into the app's bin/ folder).")
          }
        } else {
          emit('Install ffmpeg with your package manager, e.g.:')
          emit('  brew install ffmpeg')
          emit("(or drop ffmpeg + ffprobe binaries into the app's bin/ folder).")
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
