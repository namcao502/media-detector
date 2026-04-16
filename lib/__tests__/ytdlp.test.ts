import { parseProgress, parseMediaInfo, resolveOutputDir, parseDestination } from '../ytdlp'
import path from 'path'

describe('parseProgress', () => {
  it('parses a standard download progress line', () => {
    expect(parseProgress('[download]  72.3% of 48.00MiB at 1.23MiB/s ETA 00:12')).toBe(72.3)
  })

  it('parses 100%', () => {
    expect(parseProgress('[download] 100% of 48.00MiB')).toBe(100)
  })

  it('returns null for non-progress lines', () => {
    expect(parseProgress('[info] Downloading format 140')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseProgress('')).toBeNull()
  })
})

describe('parseDestination', () => {
  it('parses [download] Destination line', () => {
    expect(parseDestination('[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\test.mp4'))
      .toBe('C:\\Users\\test\\Documents\\MediaDetector\\test.mp4')
  })

  it('parses [Merger] Merging formats into line', () => {
    expect(parseDestination('[Merger] Merging formats into "C:\\Users\\test\\Documents\\MediaDetector\\test.mkv"'))
      .toBe('C:\\Users\\test\\Documents\\MediaDetector\\test.mkv')
  })

  it('returns null for non-destination lines', () => {
    expect(parseDestination('[download]  72.3% of 48.00MiB')).toBeNull()
  })
})

describe('parseMediaInfo', () => {
  const sampleDump = JSON.stringify({
    title: 'Test Video',
    uploader: 'Test Channel',
    duration: 212,
    thumbnail: 'https://example.com/thumb.jpg',
    view_count: 1000,
    formats: [
      { format_id: '137', ext: 'mp4', width: 1920, height: 1080, fps: 30, vcodec: 'avc1', acodec: 'none', filesize: 2400000000 },
      { format_id: '140', ext: 'm4a', width: null, height: null, fps: null, vcodec: 'none', acodec: 'mp4a', abr: 128, filesize: 48000000 },
      { format_id: '22', ext: 'mp4', width: 1280, height: 720, fps: 30, vcodec: 'avc1', acodec: 'mp4a', filesize: 1100000000 },
    ],
  })

  it('extracts title and channel', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.title).toBe('Test Video')
    expect(info.channel).toBe('Test Channel')
  })

  it('separates video and audio formats', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats).toHaveLength(2)
    expect(info.audioFormats).toHaveLength(1)
  })

  it('video formats have width/height', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats[0].width).toBe(1920)
    expect(info.videoFormats[0].height).toBe(1080)
  })

  it('audio formats have abr', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.audioFormats[0].abr).toBe(128)
  })

  it('sorts video formats by height descending', () => {
    const info = parseMediaInfo(sampleDump)
    expect(info.videoFormats[0].height).toBeGreaterThanOrEqual(info.videoFormats[1].height)
  })
})

describe('resolveOutputDir', () => {
  it('returns path inside Documents/MediaDetector', () => {
    const dir = resolveOutputDir()
    expect(dir).toContain('MediaDetector')
    expect(path.isAbsolute(dir)).toBe(true)
  })
})
