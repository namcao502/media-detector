'use client'

import { useEffect, useState } from 'react'

// Seconds since the last stream line arrived. yt-dlp goes silent whenever the
// transfer stalls or an ffmpeg postprocessor is running, so a ticking counter is
// the only way the UI can tell "still working" from "stuck". Returns 0 and runs
// no timer while `active` is false.
export function useIdleSeconds(lastUpdateAt: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || lastUpdateAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active, lastUpdateAt])

  if (!active || lastUpdateAt === null) return 0
  return Math.max(0, Math.floor((now - lastUpdateAt) / 1000))
}
