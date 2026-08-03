import {
  parseProgress, parseMediaInfo, resolveOutputDir, parseDestination,
  parsePlaylistItem, parsePlaylistInfo,
  reducePlaylistLine, finalizePlaylist, initialPlaylistState,
  metadataArgs, firstDirWithFfmpeg,
} from '../ytdlp'
import type { PlaylistDownloadLine, PlaylistBatchDoneLine } from '@/types/media'
import path from 'path'
import os from 'os'
import fs from 'fs'

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

describe('firstDirWithFfmpeg', () => {
  it('returns the first dir containing an ffmpeg binary', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'))
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    fs.writeFileSync(path.join(tmp, exe), '')
    try {
      expect(firstDirWithFfmpeg([path.join(os.tmpdir(), 'nope-xyz'), tmp])).toBe(tmp)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
  it('returns null when no dir contains ffmpeg', () => {
    expect(firstDirWithFfmpeg([path.join(os.tmpdir(), 'nope-abc')])).toBeNull()
  })
})

describe('metadataArgs', () => {
  it('returns [] when ffmpeg is absent', () => {
    expect(metadataArgs(false, 'm4a')).toEqual([])
  })
  it('embeds metadata, chapters, and thumbnail for a supported container', () => {
    expect(metadataArgs(true, 'm4a')).toEqual(['--embed-metadata', '--embed-chapters', '--embed-thumbnail'])
  })
  it('omits the thumbnail for webm (unsupported container)', () => {
    const args = metadataArgs(true, 'webm')
    expect(args).toContain('--embed-metadata')
    expect(args).toContain('--embed-chapters')
    expect(args).not.toContain('--embed-thumbnail')
  })
  it('includes the thumbnail when ext is omitted (playlist selects m4a)', () => {
    expect(metadataArgs(true)).toContain('--embed-thumbnail')
  })
})

describe('parsePlaylistItem', () => {
  it('parses "Downloading item N of M"', () => {
    expect(parsePlaylistItem('[download] Downloading item 3 of 10')).toEqual({ index: 3, total: 10 })
  })
  it('parses legacy "Downloading video N of M"', () => {
    expect(parsePlaylistItem('[download] Downloading video 1 of 5')).toEqual({ index: 1, total: 5 })
  })
  it('returns null for non-item lines', () => {
    expect(parsePlaylistItem('[download] 50% of 3MiB')).toBeNull()
  })
})

describe('parsePlaylistInfo', () => {
  it('extracts title, count, and indexed tracks', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [{ title: 'A' }, { title: 'B' }] })
    const info = parsePlaylistInfo(json)
    expect(info.title).toBe('Mix')
    expect(info.count).toBe(2)
    expect(info.tracks).toEqual([{ index: 1, title: 'A' }, { index: 2, title: 'B' }])
  })
  it('uses placeholder title for null/untitled entries', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [null, { title: 'B' }] })
    const info = parsePlaylistInfo(json)
    expect(info.tracks[0]).toEqual({ index: 1, title: 'Track 1' })
  })
})

describe('reducePlaylistLine + finalizePlaylist', () => {
  it('aggregates a two-track run into item/track-done/done events', () => {
    const lines = [
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\out\\Mix\\01 - A.m4a',
      '[download] 100% of 3MiB',
      '[download] Downloading item 2 of 2',
      '[download] Destination: C:\\out\\Mix\\02 - B.m4a',
      '[download] 100% of 3MiB',
    ]
    let state = initialPlaylistState
    const emits: PlaylistDownloadLine[] = []
    for (const line of lines) {
      const r = reducePlaylistLine(state, line)
      state = r.state
      emits.push(...r.emits)
    }
    emits.push(...finalizePlaylist(state, 'C:\\out'))

    expect(emits.filter((e) => e.type === 'item')).toHaveLength(2)
    expect(emits.filter((e) => e.type === 'track-done')).toHaveLength(2)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done.downloaded).toBe(2)
    expect(done.total).toBe(2)
    expect(done.failed).toBe(0)
    expect(done.folder).toContain('Mix')
  })

  it('counts a skipped track (no destination) as failed', () => {
    const lines = [
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\out\\Mix\\01 - A.m4a',
      '[download] 100% of 3MiB',
      '[download] Downloading item 2 of 2', // item 2 fails: no Destination follows
    ]
    let state = initialPlaylistState
    for (const line of lines) state = reducePlaylistLine(state, line).state
    const finals = finalizePlaylist(state, 'C:\\out')
    const done = finals.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done.downloaded).toBe(1)
    expect(done.total).toBe(2)
    expect(done.failed).toBe(1)
  })
})
