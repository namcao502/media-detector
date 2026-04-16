import { NextResponse } from 'next/server'
import { execCommand } from '@/lib/ytdlp'
import type { StatusResult, UpdateStatus } from '@/types/media'

let cachedStatus: StatusResult | null = null

async function checkPython(): Promise<{ found: boolean; version: string | null }> {
  for (const cmd of ['python --version', 'python3 --version']) {
    const result = await execCommand(cmd)
    if (result.code === 0) {
      const match = result.stdout.match(/Python ([\d.]+)/)
      return { found: true, version: match ? match[1] : result.stdout }
    }
  }
  return { found: false, version: null }
}

async function checkYtdlp(): Promise<{ found: boolean; version: string | null }> {
  const result = await execCommand('yt-dlp --version')
  if (result.code === 0) {
    return { found: true, version: result.stdout.trim() }
  }
  return { found: false, version: null }
}

async function updateYtdlp(): Promise<UpdateStatus> {
  const result = await execCommand('yt-dlp -U')
  if (result.code !== 0) return 'failed'
  const out = result.stdout.toLowerCase()
  if (out.includes('up to date') || out.includes('up-to-date')) return 'up-to-date'
  return 'updated'
}

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const forceRefresh = searchParams.get('refresh') === '1'

  if (cachedStatus && !forceRefresh) {
    return NextResponse.json(cachedStatus)
  }

  const python = await checkPython()
  let ytdlp: StatusResult['ytdlp'] = { found: false, version: null, updateStatus: 'skipped' }

  if (python.found) {
    const ytdlpCheck = await checkYtdlp()
    if (ytdlpCheck.found) {
      const updateStatus = await updateYtdlp()
      ytdlp = { ...ytdlpCheck, updateStatus }
    } else {
      ytdlp = { found: false, version: null, updateStatus: 'skipped' }
    }
  }

  cachedStatus = { python, ytdlp }
  return NextResponse.json(cachedStatus)
}

export function resetStatusCache(): void {
  cachedStatus = null
}
