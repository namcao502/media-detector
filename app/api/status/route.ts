import { NextResponse } from 'next/server'
import { execCommand, checkFfmpeg } from '@/lib/ytdlp'
import type { StatusResult, UpdateStatus } from '@/types/media'

let cachedStatus: StatusResult | null = null

async function checkPython(): Promise<{ found: boolean; version: string | null; cmd: string }> {
  for (const cmd of ['python', 'python3']) {
    const result = await execCommand(`${cmd} --version`)
    if (result.code === 0) {
      const match = result.stdout.match(/Python ([\d.]+)/)
      return { found: true, version: match ? match[1] : result.stdout, cmd }
    }
  }
  return { found: false, version: null, cmd: 'python' }
}

async function checkYtdlp(pythonCmd: string): Promise<{ found: boolean; version: string | null }> {
  // The `yt-dlp` shim lands in Python's Scripts dir (often off PATH); run the module.
  const result = await execCommand(`${pythonCmd} -m yt_dlp --version`)
  if (result.code === 0) {
    return { found: true, version: result.stdout.trim() }
  }
  return { found: false, version: null }
}

async function updateYtdlp(pythonCmd: string): Promise<UpdateStatus> {
  // yt-dlp -U self-update refuses for pip/PyPI installs; update the way it was installed.
  // Bare `pip` is often not on PATH; go through the resolved interpreter.
  const result = await execCommand(`${pythonCmd} -m pip install --upgrade yt-dlp`)
  if (result.code !== 0) return 'failed'
  const out = result.stdout.toLowerCase()
  if (out.includes('successfully installed')) return 'updated'
  return 'up-to-date' // "Requirement already satisfied"
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
    const ytdlpCheck = await checkYtdlp(python.cmd)
    if (ytdlpCheck.found) {
      const updateStatus = await updateYtdlp(python.cmd)
      ytdlp = { ...ytdlpCheck, updateStatus }
    } else {
      ytdlp = { found: false, version: null, updateStatus: 'skipped' }
    }
  }

  // ffmpeg is independent of Python -- check it regardless.
  const ffmpeg = await checkFfmpeg()

  cachedStatus = { python: { found: python.found, version: python.version }, ytdlp, ffmpeg }
  return NextResponse.json(cachedStatus)
}

export function resetStatusCache(): void {
  cachedStatus = null
}
