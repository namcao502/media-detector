import { NextResponse } from 'next/server'
import { execArgs } from '@/lib/ytdlp'

// Opens a folder in the OS file manager. xdg-open covers Linux desktops
// (Fedora KDE/Dolphin, GNOME, etc.); `open` for macOS; explorer.exe for Windows.
export function openFolderArgs(folderPath: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['explorer.exe', folderPath]
  if (platform === 'darwin') return ['open', folderPath]
  return ['xdg-open', folderPath]
}

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const folderPath = typeof body === 'object' && body !== null && 'path' in body
    ? String((body as Record<string, unknown>).path)
    : ''

  if (!folderPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  const result = await execArgs(openFolderArgs(folderPath))
  if (result.code !== 0) {
    return NextResponse.json({ error: result.stderr || 'Failed to open folder' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
