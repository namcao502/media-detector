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
        className="h-2 w-full overflow-hidden rounded-full bg-gray-700"
      >
        <div
          className="h-full bg-[#e94560] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{percent}%</span>
        {savedPath && (
          <div className="flex items-center gap-2">
            <span className="text-green-400">Saved to Documents\MediaDetector</span>
            <button
              onClick={handleOpenFolder}
              className="rounded bg-gray-700 px-2 py-0.5 text-gray-300 hover:bg-gray-600"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
