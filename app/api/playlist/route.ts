import { NextResponse } from 'next/server'
import { execArgs, parsePlaylistInfo } from '@/lib/ytdlp'
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

  // --flat-playlist avoids probing every video's formats (fast); user-controlled URL -> execArgs (spawn, no shell).
  const result = await execArgs(['yt-dlp', '--flat-playlist', '--dump-single-json', '--yes-playlist', url])

  if (result.code !== 0 || !result.stdout) {
    const message = result.stderr ? result.stderr.replace(/^ERROR:\s*/i, '') : 'Failed to fetch playlist'
    return NextResponse.json({ error: message }, { status: 422 })
  }

  try {
    const info = parsePlaylistInfo(result.stdout)
    return NextResponse.json(info)
  } catch {
    return NextResponse.json({ error: 'Failed to parse playlist' }, { status: 500 })
  }
}
