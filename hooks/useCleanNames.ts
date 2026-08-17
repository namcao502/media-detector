// hooks/useCleanNames.ts
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'clean-names'

export interface CleanNamesControls {
  clean: boolean
  toggle: () => void
}

// Whether downloads are named "<title> - <author>" with promo tags stripped, or
// left with yt-dlp's raw "<title>". Persisted in localStorage, on by default.
// Reads after mount so server and first client render agree (the stored value
// is not available during SSR).
export function useCleanNames(): CleanNamesControls {
  const [clean, setClean] = useState(true)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'off') setClean(false)
    } catch {
      // ignore storage errors (private browsing, quota exceeded)
    }
  }, [])

  const toggle = useCallback(() => {
    setClean((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])

  return { clean, toggle }
}
