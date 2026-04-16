'use client'

interface LogPanelProps {
  lines: string[]
  visible: boolean
}

export default function LogPanel({ lines, visible }: LogPanelProps) {
  if (!visible || lines.length === 0) return null
  return (
    <div className="mt-2 max-h-32 overflow-y-auto rounded bg-black/40 p-2 font-mono text-xs text-green-400">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
