'use client'

interface OutputDirRowProps {
  dir: string
  onChange: (dir: string) => void
  onReset: () => void
}

// Global "Save to" folder control. Applies to single-video and playlist downloads.
export default function OutputDirRow({ dir, onChange, onReset }: OutputDirRowProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border px-4 py-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
        Save to
      </span>
      <input
        type="text"
        value={dir}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Download folder path..."
        spellCheck={false}
        className="flex-1 rounded-xl px-3 py-2 text-xs outline-none"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      />
      <button
        onClick={onReset}
        className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 active:opacity-60"
        style={{
          background: 'var(--bg-fill)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        Reset
      </button>
    </div>
  )
}
