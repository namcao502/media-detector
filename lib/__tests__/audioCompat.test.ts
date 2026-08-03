import { isApplePlayable, sortAudioForApple } from '../audioCompat'
import type { AudioFormat } from '@/types/media'

function audio(ext: string, abr: number): AudioFormat {
  return { formatId: `${ext}-${abr}`, ext, abr, acodec: 'test', filesize: null }
}

describe('isApplePlayable', () => {
  it('accepts iOS-native containers (case-insensitive)', () => {
    expect(isApplePlayable('m4a')).toBe(true)
    expect(isApplePlayable('MP3')).toBe(true)
    expect(isApplePlayable('aac')).toBe(true)
    expect(isApplePlayable('mp4')).toBe(true)
  })

  it('rejects opus/webm/ogg', () => {
    expect(isApplePlayable('webm')).toBe(false)
    expect(isApplePlayable('opus')).toBe(false)
    expect(isApplePlayable('ogg')).toBe(false)
  })
})

describe('sortAudioForApple', () => {
  it('floats m4a above webm while keeping bitrate order within each group', () => {
    const input = [audio('webm', 160), audio('m4a', 128), audio('webm', 70), audio('m4a', 48)]
    const sorted = sortAudioForApple(input)
    expect(sorted.map((f) => f.ext)).toEqual(['m4a', 'm4a', 'webm', 'webm'])
    expect(sorted.map((f) => f.abr)).toEqual([128, 48, 160, 70])
  })

  it('does not mutate the input array', () => {
    const input = [audio('webm', 160), audio('m4a', 128)]
    const before = [...input]
    sortAudioForApple(input)
    expect(input).toEqual(before)
  })
})
