'use client'

import { useState } from 'react'
import type { StatusResult } from '@/types/media'
import LogPanel from './LogPanel'

interface StatusBarProps {
  status: StatusResult | null
  onRefresh: () => void
}

async function streamToLines(url: string, method: string, onLine: (line: string) => void): Promise<void> {
  const res = await fetch(url, { method })
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    text.split('\n').filter(Boolean).forEach(onLine)
  }
}

export default function StatusBar({ status, onRefresh }: StatusBarProps) {
  const [loading, setLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  const allOk = status?.python.found && status?.ytdlp.found

  async function handleInstall(endpoint: string) {
    setLoading(true)
    setLogLines([])
    setShowLog(true)
    await streamToLines(endpoint, 'POST', (line) => setLogLines((prev) => [...prev, line]))
    setLoading(false)
    onRefresh()
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-400">
        <span className="animate-pulse">Checking dependencies...</span>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-gray-800 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        {/* Python */}
        <div className="flex items-center gap-2">
          {status.python.found ? (
            <span className="text-green-400">Python {status.python.version}</span>
          ) : (
            <>
              <span className="text-red-400">Python not found</span>
              <a
                href="https://python.org/downloads"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500"
              >
                Install Python
              </a>
            </>
          )}
        </div>

        {/* yt-dlp */}
        <div className="flex items-center gap-2">
          {status.ytdlp.found ? (
            <span className={status.ytdlp.updateStatus === 'updated' ? 'text-green-400' : 'text-gray-400'}>
              yt-dlp {status.ytdlp.version}
              {status.ytdlp.updateStatus === 'updated' && ' (updated)'}
            </span>
          ) : (
            <>
              <span className="text-red-400">yt-dlp not found</span>
              {status.python.found && (
                <button
                  onClick={() => handleInstall('/api/ytdlp/install')}
                  disabled={loading}
                  className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {loading ? 'Installing...' : 'Install'}
                </button>
              )}
            </>
          )}
          {status.ytdlp.updateStatus === 'failed' && (
            <button
              onClick={() => handleInstall('/api/ytdlp/update')}
              disabled={loading}
              className="rounded bg-yellow-600 px-2 py-0.5 text-xs text-white hover:bg-yellow-500 disabled:opacity-50"
            >
              {loading ? 'Retrying...' : 'Retry'}
            </button>
          )}
        </div>

        {allOk && (
          <span className="ml-auto text-xs text-gray-500">
            {status.ytdlp.updateStatus === 'up-to-date' ? 'Up to date' : ''}
          </span>
        )}
      </div>

      <LogPanel lines={logLines} visible={showLog} />
    </div>
  )
}
