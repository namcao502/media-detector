import { isYouTubeUrl, extractYouTubeUrl, getYouTubeUrlKind } from '../validate'

describe('isYouTubeUrl', () => {
  it('accepts youtube.com/watch', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts music.youtube.com/watch', () => {
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts youtu.be short links', () => {
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  it('rejects non-YouTube URLs', () => {
    expect(isYouTubeUrl('https://vimeo.com/123456')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isYouTubeUrl('')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(isYouTubeUrl('not a url')).toBe(false)
  })

  it('rejects URL with youtube in path but wrong domain', () => {
    expect(isYouTubeUrl('https://evil.com/youtube.com/watch?v=x')).toBe(false)
  })
})

describe('extractYouTubeUrl', () => {
  it('returns the url trimmed', () => {
    expect(extractYouTubeUrl('  https://youtube.com/watch?v=x  ')).toBe('https://youtube.com/watch?v=x')
  })
})

describe('getYouTubeUrlKind', () => {
  it('pure playlist URL is playlist only', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/playlist?list=PL123'))
      .toEqual({ hasVideo: false, hasPlaylist: true })
  })
  it('watch+list URL is both', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc&list=PL123'))
      .toEqual({ hasVideo: true, hasPlaylist: true })
  })
  it('plain watch URL is video only', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('youtu.be short link is video only', () => {
    expect(getYouTubeUrlKind('https://youtu.be/abc'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('RD radio/mix list is not a playlist', () => {
    expect(getYouTubeUrlKind('https://www.youtube.com/watch?v=abc&list=RD123'))
      .toEqual({ hasVideo: true, hasPlaylist: false })
  })
  it('non-YouTube URL is neither', () => {
    expect(getYouTubeUrlKind('https://vimeo.com/1?list=PL1'))
      .toEqual({ hasVideo: false, hasPlaylist: false })
  })
})
