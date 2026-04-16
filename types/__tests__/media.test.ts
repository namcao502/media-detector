import type { VideoFormat, AudioFormat, MediaInfo, StatusResult, DownloadStreamLine } from '../media'

describe('media types', () => {
  it('VideoFormat shape is correct', () => {
    const f: VideoFormat = {
      formatId: '137',
      ext: 'mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      vcodec: 'avc1',
      filesize: 2400000000,
    }
    expect(f.formatId).toBe('137')
  })

  it('StatusResult allows null version', () => {
    const s: StatusResult = {
      python: { found: false, version: null },
      ytdlp: { found: false, version: null, updateStatus: 'skipped' },
    }
    expect(s.python.found).toBe(false)
  })

  it('DownloadStreamLine discriminated union works', () => {
    const line: DownloadStreamLine = { type: 'progress', percent: 42 }
    if (line.type === 'progress') {
      expect(line.percent).toBe(42)
    }
  })
})
