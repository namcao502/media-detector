import { NextResponse } from 'next/server'
import { execArgs, parseMediaInfo } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

export async function POST(req: Request): Promise<NextResponse> {
  const body: unknown = await req.json().catch(() => ({}))
  const url = typeof body === 'object' && body !== null && 'url' in body
    ? String((body as Record<string, unknown>).url)
    : ''

  if (!isYouTubeUrl(url)) {
    return NextResponse.json(
      { error: 'URL must be a YouTube or YouTube Music link' },
      { status: 400 }
    )
  }

  // Use execArgs (spawn, no shell) to prevent command injection from URL values.
  const result = await execArgs(['yt-dlp', '--dump-json', url, '--no-playlist'])

  if (result.code !== 0 || !result.stdout) {
    const message = result.stderr
      ? result.stderr.replace(/^ERROR:\s*/i, '')
      : 'Failed to fetch media info'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  try {
    const info = parseMediaInfo(result.stdout)
    return NextResponse.json(info)
  } catch {
    return NextResponse.json({ error: 'Failed to parse media info' }, { status: 500 })
  }
}
