'use client'

import { useState } from 'react'
import type { MediaInfo } from '@/types/media'
import { sortAudioForApple } from '@/lib/audioCompat'
import FormatRow from './FormatRow'

interface FormatTabsProps {
  info: MediaInfo
  url: string
  onDownloadStart?: (formatId: string, ext: string) => void
}

export default function FormatTabs({ info, url, onDownloadStart }: FormatTabsProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')

  return (
    <div>
      <div
        className="mb-4 flex gap-1 rounded-xl p-1"
        style={{ background: 'var(--bg-fill)' }}
      >
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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
            {tab}
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
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
        {activeTab === 'audio' &&
          sortAudioForApple(info.audioFormats).map((f) => (
            <FormatRow
              key={f.formatId}
              type="audio"
              format={f}
              url={url}
              title={info.title}
              onDownloadStart={onDownloadStart ?? (() => {})}
            />
          ))}
      </div>
    </div>
  )
}
