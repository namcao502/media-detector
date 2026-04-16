'use client'

import { useState } from 'react'
import type { MediaInfo } from '@/types/media'
import FormatRow from './FormatRow'

interface FormatTabsProps {
  info: MediaInfo
  url: string
}

export default function FormatTabs({ info, url }: FormatTabsProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video')

  return (
    <div>
      <div className="mb-4 flex border-b border-[#0f3460]">
        {(['video', 'audio'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-[#e94560] text-gray-100'
                : 'text-gray-500 hover:text-gray-300'
            }`}
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
              onDownloadStart={() => {}}
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
              onDownloadStart={() => {}}
            />
          ))}
      </div>
    </div>
  )
}
