'use client'

import { useEffect, useState } from 'react'
import { downloadStem, rawStem } from '@/lib/filename'
import type { NameSource } from '@/lib/filename'

interface FileNameRowProps {
  source: NameSource
  clean: boolean
  onToggle: () => void
  // Overrides the generated name; null means "use whatever the rules produce".
  customName: string | null
  onCustomNameChange: (name: string | null) => void
}

const PILL =
  'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60'

const NEUTRAL = {
  background: 'var(--bg-fill)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
}

// Shows what the download will be called before it starts, and lets the user
// switch the cleanup off or type a name outright. The extension is omitted
// because it is not settled until a format is chosen.
export default function FileNameRow({
  source,
  clean,
  onToggle,
  customName,
  onCustomNameChange,
}: FileNameRowProps) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const original = rawStem(source)
  const cleaned = downloadStem(source)
  const generated = clean ? cleaned : original
  const result = customName ?? generated
  const changed = cleaned !== original

  // A new video (or a toggle) invalidates an open editor.
  useEffect(() => {
    setEditing(false)
  }, [source.title, clean])

  function startEditing() {
    setDraft(result)
    setEditing(true)
  }

  function commit() {
    const trimmed = draft.trim()
    onCustomNameChange(trimmed === '' || trimmed === generated ? null : trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        className="rounded-2xl border px-4 py-3"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--accent)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex-shrink-0 text-xs font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            File name
          </span>
          <input
            type="text"
            value={draft}
            autoFocus
            spellCheck={false}
            aria-label="File name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs"
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
          <button
            onClick={commit}
            className={`${PILL} text-white`}
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className={PILL} style={NEUTRAL}>
            Cancel
          </button>
        </div>
        <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          The extension is added automatically. Enter to save, Escape to cancel.
        </div>
      </div>
    )
  }

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
          File name
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs"
          style={{ color: 'var(--text-primary)' }}
          title={result}
        >
          {result}
        </span>
        <button onClick={startEditing} className={PILL} style={NEUTRAL}>
          Edit
        </button>
        <button
          onClick={onToggle}
          aria-pressed={clean}
          disabled={customName !== null}
          className={`${PILL} disabled:opacity-40`}
          style={
            clean
              ? { background: 'var(--accent)', color: '#ffffff', border: '1px solid transparent' }
              : NEUTRAL
          }
        >
          {clean ? 'Cleaned' : 'Original'}
        </button>
      </div>

      {customName !== null && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Custom name
          </span>
          <button
            onClick={() => onCustomNameChange(null)}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            Reset to automatic
          </button>
        </div>
      )}

      {/* Only worth offering when the two actually differ. */}
      {customName === null && clean && changed && (
        <div className="mt-2">
          <button
            onClick={() => setShowOriginal((prev) => !prev)}
            aria-expanded={showOriginal}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            {showOriginal ? 'Hide original name' : 'Show original name'}
          </button>
          {showOriginal && (
            <div
              className="mt-1 truncate text-xs"
              style={{ color: 'var(--text-muted)' }}
              title={original}
            >
              was: {original}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
