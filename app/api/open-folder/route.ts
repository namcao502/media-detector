import { NextResponse } from 'next/server'
import { execArgs } from '@/lib/ytdlp'

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const folderPath = typeof body === 'object' && body !== null && 'path' in body
    ? String((body as Record<string, unknown>).path)
    : ''

  if (!folderPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  // Platform file-manager opener: Explorer on Windows, `open` on macOS, `xdg-open` on Linux.
  const opener = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open'
  const result = await execArgs([opener, folderPath])
  if (result.code !== 0) {
    return NextResponse.json({ error: result.stderr || 'Failed to open folder' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
