import { recommendedVideoId, recommendedAudioId } from '../recommend'
import type { VideoFormat, AudioFormat } from '@/types/media'

function video(partial: Partial<VideoFormat> & { formatId: string }): VideoFormat {
  return {
    ext: 'mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    vcodec: 'avc1',
    filesize: null,
    ...partial,
  }
}

function audio(partial: Partial<AudioFormat> & { formatId: string }): AudioFormat {
  return { ext: 'm4a', abr: 128, acodec: 'mp4a', filesize: null, ...partial }
}

describe('recommendedVideoId', () => {
  it('returns null for an empty list', () => {
    expect(recommendedVideoId([])).toBeNull()
  })

  it('picks the highest resolution', () => {
    const formats = [
      video({ formatId: 'a', height: 720 }),
      video({ formatId: 'b', height: 2160 }),
      video({ formatId: 'c', height: 1080 }),
    ]
    expect(recommendedVideoId(formats)).toBe('b')
  })

  it('breaks a resolution tie toward mp4', () => {
    const formats = [
      video({ formatId: 'webm', height: 1080, ext: 'webm' }),
      video({ formatId: 'mp4', height: 1080, ext: 'mp4' }),
    ]
    expect(recommendedVideoId(formats)).toBe('mp4')
  })

  it('breaks a resolution and container tie toward higher fps', () => {
    const formats = [
      video({ formatId: 'low', height: 1080, fps: 30 }),
      video({ formatId: 'high', height: 1080, fps: 60 }),
    ]
    expect(recommendedVideoId(formats)).toBe('high')
  })

  it('treats a null fps as zero rather than crashing', () => {
    const formats = [
      video({ formatId: 'unknown', height: 1080, fps: null }),
      video({ formatId: 'known', height: 1080, fps: 24 }),
    ]
    expect(recommendedVideoId(formats)).toBe('known')
  })
})

describe('recommendedAudioId', () => {
  it('returns null for an empty list', () => {
    expect(recommendedAudioId([])).toBeNull()
  })

  it('prefers the highest bitrate among iPhone-playable containers', () => {
    const formats = [
      audio({ formatId: 'opus-high', ext: 'webm', abr: 160 }),
      audio({ formatId: 'm4a-low', ext: 'm4a', abr: 128 }),
      audio({ formatId: 'm4a-high', ext: 'm4a', abr: 192 }),
    ]
    expect(recommendedAudioId(formats)).toBe('m4a-high')
  })

  it('falls back to the overall highest bitrate when nothing is Apple-playable', () => {
    const formats = [
      audio({ formatId: 'opus-low', ext: 'webm', abr: 70 }),
      audio({ formatId: 'opus-high', ext: 'webm', abr: 160 }),
    ]
    expect(recommendedAudioId(formats)).toBe('opus-high')
  })

  it('treats a null bitrate as zero', () => {
    const formats = [
      audio({ formatId: 'unknown', abr: null }),
      audio({ formatId: 'known', abr: 96 }),
    ]
    expect(recommendedAudioId(formats)).toBe('known')
  })
})
