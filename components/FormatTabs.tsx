'use client'

import { useMemo, useState } from 'react'
import type { MediaInfo } from '@/types/media'
import { sortAudioForApple } from '@/lib/audioCompat'
import { recommendedVideoId, recommendedAudioId } from '@/lib/recommend'
import FormatRow from './FormatRow'

interface FormatTabsProps {
  info: MediaInfo
  url: string
  outputDir: string
  cleanNames?: boolean
  customName?: string | null
  onDownloadStart?: (formatId: string, ext: string) => void
}

export default function FormatTabs({
  info,
  url,
  outputDir,
  cleanNames = true,
  customName = null,
  onDownloadStart,
}: FormatTabsProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')

  const bestVideoId = useMemo(() => recommendedVideoId(info.videoFormats), [info.videoFormats])
  const bestAudioId = useMemo(() => recommendedAudioId(info.audioFormats), [info.audioFormats])
  const sortedAudio = useMemo(() => sortAudioForApple(info.audioFormats), [info.audioFormats])

  const counts = { video: info.videoFormats.length, audio: info.audioFormats.length }

  return (
    <div>
      <div className="mb-3 flex gap-1 rounded-xl p-1" style={{ background: 'var(--bg-fill)' }}>
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className="flex-1 rounded-lg py-1.5 text-sm font-semibold capitalize transition-colors"
            style={
              activeTab === tab
                ? {
                    color: 'var(--text-primary)',
                    background: 'var(--bg-elevated)',
                    boxShadow: 'var(--shadow-pill)',
                  }
                : {
                    color: 'var(--text-secondary)',
                    background: 'transparent',
                  }
            }
          >
            {tab} <span style={{ opacity: 0.6 }}>{counts[tab]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {activeTab === 'video' &&
          info.videoFormats.map((f) => (
            <FormatRow
              key={f.formatId}
              type="video"
              format={f}
              url={url}
              title={info.title}
              outputDir={outputDir}
              artist={info.artist}
              track={info.track}
              channel={info.channel}
              cleanNames={cleanNames}
              customName={customName}
              recommended={f.formatId === bestVideoId}
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
        {activeTab === 'audio' &&
          sortedAudio.map((f) => (
            <FormatRow
              key={f.formatId}
              type="audio"
              format={f}
              url={url}
              title={info.title}
              outputDir={outputDir}
              artist={info.artist}
              track={info.track}
              channel={info.channel}
              cleanNames={cleanNames}
              customName={customName}
              recommended={f.formatId === bestAudioId}
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
      </div>
    </div>
  )
}
