// hooks/useOutputDir.ts
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'output-dir'

export interface OutputDirControls {
  dir: string
  setDir: (dir: string) => void
  reset: () => void
}

// Manages the download folder: a user-editable path persisted in localStorage,
// defaulting to the server-resolved ~/Documents/MediaDetector. Mirrors useTheme.
export function useOutputDir(): OutputDirControls {
  const [dir, setDirState] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try {
      return localStorage.getItem(STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })

  // When nothing is stored, fetch the OS-specific default from the server.
  useEffect(() => {
    if (dir) return
    let cancelled = false
    fetch('/api/output-dir')
      .then((res) => res.json())
      .then((data: { dir?: string }) => {
        if (!cancelled && typeof data.dir === 'string') setDirState(data.dir)
      })
      .catch(() => {
        // leave dir empty; the server falls back to its default on download
      })
    return () => {
      cancelled = true
    }
  }, [dir])

  const setDir = useCallback((next: string) => {
    setDirState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore storage errors (private browsing, quota exceeded)
    }
  }, [])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
    setDirState('') // triggers the effect above to re-fetch the server default
  }, [])

  return { dir, setDir, reset }
}
