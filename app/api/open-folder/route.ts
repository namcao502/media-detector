import { NextResponse } from 'next/server'
import { execArgs } from '@/lib/ytdlp'

// Opens a folder in the OS file manager. Windows and macOS only -- returns null
// on any other platform so the route can answer with a clear "unsupported".
export function openFolderArgs(folderPath: string, platform: NodeJS.Platform = process.platform): string[] | null {
  if (platform === 'win32') return ['explorer.exe', folderPath]
  if (platform === 'darwin') return ['open', folderPath]
  return null
}

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const folderPath = typeof body === 'object' && body !== null && 'path' in body
    ? String((body as Record<string, unknown>).path)
    : ''

  if (!folderPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  const args = openFolderArgs(folderPath)
  if (args === null) {
    return NextResponse.json(
      { error: 'Opening a folder is supported on Windows and macOS only' },
      { status: 501 },
    )
  }

  const result = await execArgs(args)
  if (result.code !== 0) {
    return NextResponse.json({ error: result.stderr || 'Failed to open folder' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
