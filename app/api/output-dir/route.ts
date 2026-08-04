import { NextResponse } from 'next/server'
import { resolveOutputDir } from '@/lib/ytdlp'

// Exposes the OS-specific default download folder so the client can display and
// pre-fill it (the browser cannot resolve ~/Documents on its own).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ dir: resolveOutputDir() })
}
