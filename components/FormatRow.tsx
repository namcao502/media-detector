'use client'

import { useState } from 'react'
import type { VideoFormat, AudioFormat, DownloadStreamLine } from '@/types/media'
import DownloadProgress from './DownloadProgress'

type FormatRowProps =
  | { type: 'video'; format: VideoFormat; url: string; title: string; onDownloadStart: (formatId: string, ext: string) => void }
  | { type: 'audio'; format: AudioFormat; url: string; title: string; onDownloadStart: (formatId: string, ext: string) => void }

function formatFilesize(bytes: number | null): string {
  if (bytes === null) return 'unknown size'
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1e6
  return `${mb.toFixed(0)} MB`
}

export default function FormatRow({ type, format, url, title, onDownloadStart }: FormatRowProps) {
  const [percent, setPercent] = useState<number | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const label = type === 'video'
    ? `${(format as VideoFormat).height}p`
    : `${(format as AudioFormat).abr ?? '?'}kbps`

  const codec = type === 'video'
    ? (format as VideoFormat).vcodec
    : (format as AudioFormat).acodec

  async function handleDownload() {
    setDownloading(true)
    setPercent(0)
    setSavedPath(null)
    onDownloadStart(format.formatId, format.ext)

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formatId: format.formatId, title, ext: format.ext }),
      })

      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as DownloadStreamLine
            if (parsed.type === 'progress') setPercent(parsed.percent)
            if (parsed.type === 'done') { setSavedPath(parsed.savedPath); setPercent(100) }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rounded-lg bg-[#16213e] px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded bg-[#0f3460] px-2 py-0.5 text-xs font-bold text-blue-300">{label}</span>
          <div>
            <span className="text-sm text-gray-200">{format.ext.toUpperCase()}</span>
            <span className="ml-2 text-xs text-gray-500">{codec}</span>
            {type === 'video' && (format as VideoFormat).fps && (
              <span className="ml-2 text-xs text-gray-500">{(format as VideoFormat).fps}fps</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{formatFilesize(format.filesize)}</span>
          {!downloading && !savedPath && (
            <button
              onClick={handleDownload}
              className="rounded bg-[#e94560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#d63651]"
            >
              Download
            </button>
          )}
        </div>
      </div>
      {(percent !== null || savedPath) && (
        <DownloadProgress percent={percent ?? 0} savedPath={savedPath} />
      )}
    </div>
  )
}
