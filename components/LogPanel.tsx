'use client'

interface LogPanelProps {
  lines: string[]
  visible: boolean
}

export default function LogPanel({ lines, visible }: LogPanelProps) {
  if (!visible || lines.length === 0) return null
  return (
    <div
      className="mt-2 max-h-32 overflow-y-auto rounded px-3 py-2 font-mono text-xs"
      style={{ background: 'var(--log-bg)', color: 'var(--log-text)' }}
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
