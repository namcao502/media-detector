'use client'

import { useEffect, useState } from 'react'
import StatusBar from '@/components/StatusBar'
import UrlInput from '@/components/UrlInput'
import MediaInfo from '@/components/MediaInfo'
import FormatTabs from '@/components/FormatTabs'
import type { MediaInfo as MediaInfoType, StatusResult } from '@/types/media'
import ThemeButton from '@/components/ThemeButton'
import { useTheme } from '@/hooks/useTheme'

export default function Home() {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [url, setUrl] = useState('')
  const [mediaInfo, setMediaInfo] = useState<MediaInfoType | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const theme = useTheme()

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
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ position: 'absolute', right: 0, top: 0 }}>
          <ThemeButton
            accentHex={theme.accentHex}
            isRainbow={theme.isRainbow}
            setPreset={theme.setPreset}
            toggleRainbow={theme.toggleRainbow}
          />
        </div>
        <h1
          className="text-2xl font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-primary)' }}
        >
          Media Detector
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          YouTube & YouTube Music
        </p>
      </div>

      <StatusBar status={status} onRefresh={() => fetchStatus(true)} />

      <UrlInput
        onDetect={handleDetect}
        disabled={!depsReady}
        loading={detecting}
      />

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            background: 'var(--bg-status-error)',
            borderColor: 'var(--border-status-error)',
            color: 'var(--text-status-error)',
          }}
        >
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
