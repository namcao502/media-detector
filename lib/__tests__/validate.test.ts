import { isYouTubeUrl, extractYouTubeUrl } from '../validate'

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
