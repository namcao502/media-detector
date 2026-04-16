'use client'

import { useState } from 'react'
import type { MediaInfo } from '@/types/media'
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
        className="mb-4 flex border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-2 text-xs font-bold uppercase tracking-wide transition-colors"
            style={
              activeTab === tab
                ? {
                    color: 'var(--text-primary)',
                    borderBottom: '2px solid var(--accent)',
                    marginBottom: '-1px',
                  }
                : {
                    color: 'var(--text-muted)',
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
          info.audioFormats.map((f) => (
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
