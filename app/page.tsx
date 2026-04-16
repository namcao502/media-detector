'use client'

import { useEffect, useState } from 'react'
import StatusBar from '@/components/StatusBar'
import UrlInput from '@/components/UrlInput'
import MediaInfo from '@/components/MediaInfo'
import FormatTabs from '@/components/FormatTabs'
import type { MediaInfo as MediaInfoType, StatusResult } from '@/types/media'

export default function Home() {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [url, setUrl] = useState('')
  const [mediaInfo, setMediaInfo] = useState<MediaInfoType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const depsReady = status?.python.found && status?.ytdlp.found

  async function fetchStatus(forceRefresh = false) {
    try {
      const url = forceRefresh ? '/api/status?refresh=1' : '/api/status'
      const res = await fetch(url)
      const data = await res.json()
      setStatus(data)
    } catch {
      // status will remain null, showing loading state
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  async function handleDetect(inputUrl: string) {
    setUrl(inputUrl)
    setError(null)
    setMediaInfo(null)
    setDetecting(true)

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Detection failed')
      } else {
        setMediaInfo(data)
      }
    } catch {
      setError('Network error. Is the server running?')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold uppercase tracking-widest text-gray-100">
          Media Detector
        </h1>
        <p className="mt-1 text-xs text-gray-500">YouTube & YouTube Music</p>
      </div>

      <StatusBar status={status} onRefresh={() => fetchStatus(true)} />

      <UrlInput
        onDetect={handleDetect}
        disabled={!depsReady}
        loading={detecting}
      />

      {error && (
        <div className="rounded-lg bg-red-900/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {mediaInfo && (
        <div className="space-y-4">
          <MediaInfo info={mediaInfo} />
          <FormatTabs info={mediaInfo} url={url} />
        </div>
      )}
    </main>
  )
}
