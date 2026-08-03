// hooks/useTheme.ts
import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'
const STORAGE_KEY = 'theme-mode'

function systemMode(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface ThemeControls {
  mode: ThemeMode
  toggle: () => void
}

export function useTheme(): ThemeControls {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : systemMode()
  })

  // Drive the CSS via data-theme on <html> (light tokens are the default :root).
  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore storage errors (private browsing, quota exceeded)
      }
      return next
    })
  }, [])

  return { mode, toggle }
}
