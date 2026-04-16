// components/ThemeButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { ThemeControls } from '@/hooks/useTheme'

const PRESETS: { label: string; hex: string }[] = [
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Green', hex: '#10b981' },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Cyan', hex: '#06b6d4' },
]

const PRESET_HEXES = new Set(PRESETS.map((p) => p.hex))

export default function ThemeButton({ accentHex, isRainbow, setPreset, toggleRainbow }: ThemeControls) {
  const [open, setOpen] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const isCustomActive = !PRESET_HEXES.has(accentHex) && !isRainbow

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        aria-label="Theme"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          cursor: 'pointer',
          padding: '4px 10px',
          color: 'var(--text-secondary)',
          fontSize: '16px',
          lineHeight: 1,
        }}
      >
        &#127912;
      </button>

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Theme picker"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '14px',
            width: '224px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Accent Color
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {/* Custom color picker -- first position */}
            <div style={{ position: 'relative' }}>
              <button
                aria-label="Color custom"
                data-active={isCustomActive ? 'true' : undefined}
                onClick={() => colorInputRef.current?.click()}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: accentHex,
                  border: isCustomActive ? '2px solid var(--text-primary)' : '2px solid var(--border)',
                  boxShadow: isCustomActive ? '0 0 0 2px var(--bg-card) inset' : 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: '14px', pointerEvents: 'none', lineHeight: 1 }}>+</span>
              </button>
              <input
                ref={colorInputRef}
                type="color"
                value={accentHex}
                onChange={(e) => setPreset(e.target.value)}
                style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none', top: 0, left: 0 }}
              />
            </div>

            {/* Preset swatches */}
            {PRESETS.map(({ label, hex }) => {
              const isActive = accentHex === hex && !isRainbow
              return (
                <button
                  key={hex}
                  aria-label={`Color ${label}`}
                  data-active={isActive ? 'true' : undefined}
                  onClick={() => { setPreset(hex); setOpen(false) }}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: hex,
                    border: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
                    boxShadow: isActive ? '0 0 0 2px var(--bg-card) inset' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              )
            })}
          </div>

          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Rainbow Mode
          </div>

          <button
            aria-label="Rainbow mode"
            onClick={toggleRainbow}
            style={{
              width: '100%',
              height: '28px',
              borderRadius: '8px',
              background:
                'linear-gradient(to right, #e94560, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6, #ec4899, #e94560)',
              border: 'none',
              cursor: 'pointer',
              outline: isRainbow ? '2px solid var(--text-primary)' : 'none',
              outlineOffset: '2px',
            }}
          />
        </div>
      )}
    </div>
  )
}
