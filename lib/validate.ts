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
