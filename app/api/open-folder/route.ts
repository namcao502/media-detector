import { NextResponse } from 'next/server'
import { execCommand } from '@/lib/ytdlp'

export async function POST(req: Request): Promise<Response> {
  const body: unknown = await req.json().catch(() => ({}))
  const folderPath = typeof body === 'object' && body !== null && 'path' in body
    ? String((body as Record<string, unknown>).path)
    : ''

  if (!folderPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  }

  await execCommand(`explorer.exe "${folderPath}"`)
  return NextResponse.json({ ok: true })
}
