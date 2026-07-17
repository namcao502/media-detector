const YOUTUBE_HOSTS = ['www.youtube.com', 'youtube.com', 'music.youtube.com', 'youtu.be']

export function isYouTubeUrl(input: string): boolean {
  if (!input) return false
  try {
    const url = new URL(input.trim())
    return YOUTUBE_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

export function extractYouTubeUrl(input: string): string {
  return input.trim()
}

export interface YouTubeUrlKind {
  hasVideo: boolean
  hasPlaylist: boolean
}

export function getYouTubeUrlKind(input: string): YouTubeUrlKind {
  try {
    const url = new URL(input.trim())
    if (!YOUTUBE_HOSTS.includes(url.hostname)) return { hasVideo: false, hasPlaylist: false }
    const list = url.searchParams.get('list')
    // ponytail: exclude RD* (auto-generated radio/mix) -- effectively endless, not a real playlist
    const hasPlaylist = !!list && !list.startsWith('RD')
    const isShortLink = url.hostname === 'youtu.be' && url.pathname.length > 1
    const hasVideo = !!url.searchParams.get('v') || isShortLink
    return { hasVideo, hasPlaylist }
  } catch {
    return { hasVideo: false, hasPlaylist: false }
  }
}
