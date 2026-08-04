import {
  parseProgress, parseMediaInfo, resolveOutputDir, ensureOutputDir, parseDestination,
  parsePlaylistInfo, parsePlaylistEntries, sanitizeFolderName, orchestratePlaylist,
  metadataArgs, firstDirWithFfmpeg, playlistFormatArgs,
} from '../ytdlp'
import type { TrackDownloader, TrackOutcome } from '../ytdlp'
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

describe('ensureOutputDir', () => {
  it('uses an absolute custom dir', () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'))
    try {
      expect(ensureOutputDir(custom)).toBe(custom)
    } finally {
      fs.rmSync(custom, { recursive: true, force: true })
    }
  })
  it('creates the custom dir when missing', () => {
    const custom = path.join(os.tmpdir(), `out-new-${Date.now()}`)
    try {
      ensureOutputDir(custom)
      expect(fs.existsSync(custom)).toBe(true)
    } finally {
      fs.rmSync(custom, { recursive: true, force: true })
    }
  })
  it('falls back to the default for empty or relative input', () => {
    expect(ensureOutputDir('')).toBe(resolveOutputDir())
    expect(ensureOutputDir('relative/path')).toBe(resolveOutputDir())
    expect(ensureOutputDir()).toBe(resolveOutputDir())
  })
})

describe('playlistFormatArgs', () => {
  it('m4a with ffmpeg extracts to a consistent m4a container', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'm4a' }, true)
    expect(formatArgs).toEqual(['-x', '--audio-format', 'm4a'])
    expect(expectedExt).toBe('m4a')
  })
  it('m4a without ffmpeg falls back to format selection', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'm4a' }, false)
    expect(formatArgs).toEqual(['-f', 'bestaudio[ext=m4a]/bestaudio/best'])
    expect(expectedExt).toBe('m4a')
  })
  it('mp3 re-encodes to mp3', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'mp3' }, true)
    expect(formatArgs).toEqual(['-x', '--audio-format', 'mp3'])
    expect(expectedExt).toBe('mp3')
  })
  it('best audio keeps native container and reports webm (no thumbnail)', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'best' }, true)
    expect(formatArgs).toEqual(['-f', 'bestaudio/best'])
    expect(expectedExt).toBe('webm')
  })
  it('video 1080 caps height, prefers mp4, and forces mp4 merge', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'video', videoQuality: '1080' }, true)
    expect(formatArgs).toContain('--merge-output-format')
    expect(formatArgs).toContain('mp4')
    expect(formatArgs[1]).toContain('height<=1080')
    expect(formatArgs[1]).toContain('[ext=mp4]')
    expect(expectedExt).toBe('mp4')
  })
  it('video best does not cap height', () => {
    const { formatArgs } = playlistFormatArgs({ mode: 'video', videoQuality: 'best' }, true)
    expect(formatArgs[1]).not.toContain('height<=')
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

describe('parsePlaylistEntries', () => {
  it('extracts the playlist title and each entry id + title', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [{ id: 'x1', title: 'A' }, { id: 'x2', title: 'B' }] })
    expect(parsePlaylistEntries(json)).toEqual({
      title: 'Mix',
      entries: [{ id: 'x1', title: 'A' }, { id: 'x2', title: 'B' }],
    })
  })
  it('drops null entries and entries without an id, defaulting missing titles', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [null, { title: 'no id' }, { id: 'x3' }] })
    const { entries } = parsePlaylistEntries(json)
    expect(entries).toEqual([{ id: 'x3', title: 'Track 1' }])
  })
})

describe('sanitizeFolderName', () => {
  it('replaces filesystem-illegal characters', () => {
    const out = sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j')
    expect(out).not.toMatch(/[\\/:*?"<>|]/)
  })
  it('trims trailing dots and spaces', () => {
    expect(sanitizeFolderName('My Mix... ')).toBe('My Mix')
  })
  it('falls back to Playlist for empty/whitespace names', () => {
    expect(sanitizeFolderName('   ')).toBe('Playlist')
  })
})

describe('orchestratePlaylist', () => {
  const noSleep = async () => {}
  const track = (id: string, index: number) => ({ id, title: id.toUpperCase(), index })

  async function collect(gen: AsyncGenerator<PlaylistDownloadLine>): Promise<PlaylistDownloadLine[]> {
    const out: PlaylistDownloadLine[] = []
    for await (const line of gen) out.push(line)
    return out
  }

  // Fake downloader: succeeds/fails per (id, call number); records call counts.
  function makeDownload(
    ok: (id: string, call: number) => boolean,
    calls: Record<string, number>,
  ): TrackDownloader {
    return async function* (t) {
      calls[t.id] = (calls[t.id] ?? 0) + 1
      yield 100 // one progress tick
      return { ok: ok(t.id, calls[t.id]) } as TrackOutcome
    }
  }

  it('downloads every track once when all succeed', async () => {
    const calls: Record<string, number> = {}
    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2)],
      makeDownload(() => true, calls),
      { attemptsPerPhase: 5, folder: 'C:\\out\\Mix', backoffMs: 0, sleep: noSleep },
    ))
    expect(emits.filter((e) => e.type === 'track-done')).toHaveLength(2)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ downloaded: 2, total: 2, failed: 0, folder: 'C:\\out\\Mix' })
    expect(calls).toEqual({ a: 1, b: 1 })
  })

  it('skips a track that fails phase 1 then recovers in phase 2', async () => {
    const calls: Record<string, number> = {}
    // 'b' fails its 5 phase-1 attempts, succeeds on the first phase-2 attempt (call 6)
    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2)],
      makeDownload((id, call) => (id === 'b' ? call >= 6 : true), calls),
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 0, sleep: noSleep },
    ))
    expect(emits.some((e) => e.type === 'track-skipped' && e.index === 2)).toBe(true)
    expect(emits.some((e) => e.type === 'track-retry' && e.phase === 1)).toBe(true)
    expect(emits.filter((e) => e.type === 'track-done')).toHaveLength(2)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ downloaded: 2, failed: 0 })
    expect(calls.b).toBe(6)
  })

  it('marks a permanently failing track as error after 5 + 5 attempts', async () => {
    const calls: Record<string, number> = {}
    let sleeps = 0
    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2)],
      makeDownload((id) => id !== 'b', calls),
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 1000, sleep: async () => { sleeps++ } },
    ))
    const errs = emits.filter((e) => e.type === 'track-error')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ index: 2, title: 'B' })
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ downloaded: 1, total: 2, failed: 1 })
    expect(calls.b).toBe(10) // 5 in phase 1 + 5 in phase 2
    expect(emits.some((e) => e.type === 'track-retry' && e.phase === 2)).toBe(true)
    expect(sleeps).toBe(8) // 4 between-attempt waits per phase, both phases
  })
})
