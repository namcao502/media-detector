export type StatusIconKind = 'check' | 'error' | 'warn' | 'active' | 'idle'

interface StatusIconProps {
  kind: StatusIconKind
  size?: number
  // When set the icon is exposed to assistive tech; otherwise it is decorative.
  label?: string
}

const FILL: Record<StatusIconKind, string> = {
  check: 'var(--status-ok)',
  error: 'var(--status-error)',
  warn: 'var(--status-warn)',
  active: 'var(--accent)',
  idle: 'transparent',
}

// Filled-disc status glyphs in the Apple style: a solid colour circle with a
// white mark punched out of it. `idle` is an empty hairline ring so a pending
// list item still occupies the same width as a finished one.
export default function StatusIcon({ kind, size = 16, label }: StatusIconProps) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="flex-shrink-0"
      {...a11y}
    >
      <circle
        cx="8"
        cy="8"
        r={kind === 'idle' ? 6.5 : 8}
        fill={FILL[kind]}
        stroke={kind === 'idle' ? 'var(--border)' : 'none'}
        strokeWidth={kind === 'idle' ? 1.5 : 0}
      />
      {kind === 'check' && (
        <path
          d="M4.5 8.2l2.3 2.3 4.7-4.9"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === 'error' && (
        <path
          d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
      {kind === 'warn' && (
        <path
          d="M8 4.2v4.4M8 11.2v.1"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
      {kind === 'active' && <circle cx="8" cy="8" r="3" fill="#ffffff" />}
    </svg>
  )
}
