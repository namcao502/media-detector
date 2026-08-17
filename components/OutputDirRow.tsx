'use client'

import { useState } from 'react'

interface OutputDirRowProps {
  dir: string
  onChange: (dir: string) => void
  onReset: () => void
}

const PILL =
  'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60'

const PILL_STYLE = {
  background: 'var(--bg-fill)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
}

// Global "Save to" folder control. Applies to single-video and playlist
// downloads. Collapsed to a single readable line by default -- it is settings,
// not the main task -- and expands to an editable field on demand.
export default function OutputDirRow({ dir, onChange, onReset }: OutputDirRowProps) {
  const [editing, setEditing] = useState(false)

  return (
    <div
      className="rounded-2xl border px-4 py-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex-shrink-0 text-xs font-semibold"
          style={{ color: 'var(--text-secondary)' }}
        >
          Save to
        </span>
        {!editing && (
          <span
            className="min-w-0 flex-1 truncate text-xs"
            style={{ color: 'var(--text-primary)' }}
            title={dir}
          >
            {dir || 'Default folder'}
          </span>
        )}
        {editing && (
          <input
            type="text"
            value={dir}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Download folder path..."
            spellCheck={false}
            autoComplete="off"
            aria-label="Download folder path"
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs"
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
        )}
        {editing && (
          <button onClick={onReset} className={PILL} style={PILL_STYLE}>
            Reset
          </button>
        )}
        <button
          onClick={() => setEditing((prev) => !prev)}
          className={PILL}
          style={PILL_STYLE}
        >
          {editing ? 'Done' : 'Change'}
        </button>
      </div>
    </div>
  )
}
