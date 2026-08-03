'use client'

interface DownloadProgressProps {
  percent: number
  savedPath: string | null
}

export default function DownloadProgress({ percent, savedPath }: DownloadProgressProps) {
  async function handleOpenFolder() {
    if (!savedPath) return
    const dir = savedPath.split(/[\\/]/).slice(0, -1).join('\\')
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir }),
    })
  }

  return (
    <div className="mt-2 space-y-1">
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--border)' }}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${percent}%`, background: 'var(--accent)' }}
        />
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>{percent}%</span>
        {savedPath && (
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--status-ok)' }}>Saved to Documents\MediaDetector</span>
            <button
              onClick={handleOpenFolder}
              className="rounded-full px-3 py-0.5 text-xs transition-opacity hover:opacity-80 active:opacity-60"
              style={{
                background: 'var(--bg-fill)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
