import { streamCommand, execCommand } from '@/lib/ytdlp'

// Installs ffmpeg (which bundles ffprobe) via a platform-appropriate package
// manager, streaming progress as plain text. Windows: winget (user-scope, no
// admin) then Chocolatey. macOS: Homebrew (user-owned, no sudo). Those are the
// only supported platforms.
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
        } else if (process.platform === 'darwin') {
          const hasBrew = (await execCommand('brew --version')).code === 0
          if (hasBrew) {
            emit('Installing ffmpeg via Homebrew...')
            args = ['brew', 'install', 'ffmpeg']
          } else {
            emit('Homebrew was not found. Install it from https://brew.sh')
            emit('then run:  brew install ffmpeg')
          }
        } else {
          emit(`Automatic ffmpeg install is not supported on ${process.platform}.`)
          emit('This app supports Windows and macOS.')
          emit('Install ffmpeg yourself and put it on PATH, then click Recheck.')
        }

        if (args) {
          for await (const line of streamCommand(args)) emit(line)
          emit('Done. If the ffmpeg row stays red, click Recheck (or restart the dev server) to pick it up.')
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } })
}
