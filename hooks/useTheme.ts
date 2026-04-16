// hooks/useTheme.ts
import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_ACCENT = '#e94560'
const STORAGE_KEY = 'theme-accent'
const RAINBOW_KEY = 'theme-rainbow'

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360
  const sNorm = s / 100
  const lNorm = l / 100
  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm
  const p = 2 * lNorm - q
  const hue2rgb = (input: number): number => {
    const t = input < 0 ? input + 1 : input > 1 ? input - 1 : input
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${toHex(hue2rgb(hNorm + 1 / 3))}${toHex(hue2rgb(hNorm))}${toHex(hue2rgb(hNorm - 1 / 3))}`
}

function isDarkMode(): boolean {
  if (typeof window === 'undefined') return true
  if (!window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(hex: string): void {
  const [h, s, l] = hexToHsl(hex)
  const dark = isDarkMode()
  document.documentElement.style.setProperty('--accent', hex)
  document.documentElement.style.setProperty('--accent-hover', hslToHex(h, s, Math.max(0, l - 10)))
  if (dark) {
    document.documentElement.style.setProperty('--bg-page', hslToHex(h, 55, 10))
    document.documentElement.style.setProperty('--bg-card', hslToHex(h, 52, 15))
    document.documentElement.style.setProperty('--bg-input', hslToHex(h, 58, 20))
    document.documentElement.style.setProperty('--border', hslToHex(h, 58, 25))
  } else {
    document.documentElement.style.setProperty('--bg-page', hslToHex(h, 40, 85))
    document.documentElement.style.setProperty('--bg-card', hslToHex(h, 30, 92))
    document.documentElement.style.setProperty('--bg-input', hslToHex(h, 30, 92))
    document.documentElement.style.setProperty('--border', hslToHex(h, 40, 75))
  }
}

function applyRainbowAt(hue: number): void {
  const dark = isDarkMode()
  document.documentElement.style.setProperty('--accent', hslToHex(hue, 80, 55))
  document.documentElement.style.setProperty('--accent-hover', hslToHex(hue, 80, 45))
  if (dark) {
    document.documentElement.style.setProperty('--bg-page', hslToHex(hue, 55, 10))
    document.documentElement.style.setProperty('--bg-card', hslToHex(hue, 52, 15))
    document.documentElement.style.setProperty('--bg-input', hslToHex(hue, 58, 20))
    document.documentElement.style.setProperty('--border', hslToHex(hue, 58, 25))
  } else {
    document.documentElement.style.setProperty('--bg-page', hslToHex(hue, 40, 85))
    document.documentElement.style.setProperty('--bg-card', hslToHex(hue, 30, 92))
    document.documentElement.style.setProperty('--bg-input', hslToHex(hue, 30, 92))
    document.documentElement.style.setProperty('--border', hslToHex(hue, 40, 75))
  }
}

export interface ThemeControls {
  accentHex: string
  isRainbow: boolean
  setPreset: (hex: string) => void
  toggleRainbow: () => void
}

export function useTheme(): ThemeControls {
  const [accentHex, setAccentHex] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ACCENT
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ACCENT
  })
  const [isRainbow, setIsRainbow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem(RAINBOW_KEY) !== 'false'
  })
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const hueRef = useRef(0)

  // Always apply static theme when accent changes (provides initial render colors)
  useEffect(() => {
    applyTheme(accentHex)
  }, [accentHex])

  // Manage rainbow animation loop; restores preset colors when turned off
  useEffect(() => {
    if (!isRainbow) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      applyTheme(accentHex)
      return
    }
    const animate = () => {
      hueRef.current = (hueRef.current + 0.5) % 360
      applyRainbowAt(hueRef.current)
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isRainbow, accentHex])

  const setPreset = useCallback((hex: string) => {
    setIsRainbow(false)
    setAccentHex(hex)
    try {
      localStorage.setItem(STORAGE_KEY, hex)
      localStorage.setItem(RAINBOW_KEY, 'false')
    } catch {
      // ignore storage errors (private browsing, quota exceeded)
    }
  }, [])

  const toggleRainbow = useCallback(() => {
    setIsRainbow((prev) => {
      const next = !prev
      try {
        localStorage.setItem(RAINBOW_KEY, String(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])

  return { accentHex, isRainbow, setPreset, toggleRainbow }
}
