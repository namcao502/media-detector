import { formatBytes, formatSpeed, formatDuration, parentDir } from '../format'

describe('parentDir', () => {
  it('splits a Windows path and keeps backslashes', () => {
    expect(parentDir('C:\\Users\\me\\Documents\\MediaDetector\\song.m4a')).toBe(
      'C:\\Users\\me\\Documents\\MediaDetector',
    )
  })

  it('splits a POSIX path and keeps forward slashes', () => {
    expect(parentDir('/Users/me/Music/song.m4a')).toBe('/Users/me/Music')
  })

  it('returns the root for a file directly under POSIX root', () => {
    expect(parentDir('/song.m4a')).toBe('/')
  })

  it('returns an empty string when there is no separator', () => {
    expect(parentDir('song.m4a')).toBe('')
  })
})

describe('formatBytes', () => {
  it('scales through decimal units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5_200_000)).toBe('5.2 MB')
    expect(formatBytes(2_400_000_000)).toBe('2.4 GB')
  })

  it('drops the decimal past 100 units for a stabler width', () => {
    expect(formatBytes(345_000_000)).toBe('345 MB')
  })

  it('renders a placeholder for unknown values', () => {
    expect(formatBytes(undefined)).toBe('--')
    expect(formatBytes(Number.NaN)).toBe('--')
  })
})

describe('formatSpeed', () => {
  it('appends a per-second suffix', () => {
    expect(formatSpeed(1_200_000)).toBe('1.2 MB/s')
  })

  it('renders a placeholder for unknown or zero speed', () => {
    expect(formatSpeed(undefined)).toBe('--')
    expect(formatSpeed(0)).toBe('--')
  })
})

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(14)).toBe('0:14')
    expect(formatDuration(95)).toBe('1:35')
  })

  it('adds an hours field past 3600s', () => {
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  it('renders a placeholder for unknown values', () => {
    expect(formatDuration(undefined)).toBe('--')
  })
})
