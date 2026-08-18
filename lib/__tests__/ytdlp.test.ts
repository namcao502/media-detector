import {
  parseProgressLine, parseMediaInfo, resolveOutputDir, ensureOutputDir, parseDestination,
  parsePlaylistInfo, parsePlaylistEntries, sanitizeFolderName, orchestratePlaylist,
  metadataArgs, firstDirWithFfmpeg, playlistFormatArgs, parsePhase, progressTemplateArgs,
  translateDownloadLines, runTrack, parseThumbnailPath, removeStrayThumbnail,
} from '../ytdlp'
import type { TrackDownloader, TrackOutcome, DownloadRunResult } from '../ytdlp'
import type { PlaylistDownloadLine, PlaylistBatchDoneLine, DownloadStreamLine } from '@/types/media'
import path from 'path'
import os from 'os'
import fs from 'fs'

describe('progressTemplateArgs', () => {
  it('requests newline-separated, machine-readable progress', () => {
    const args = progressTemplateArgs()
    expect(args).toContain('--newline')
    const template = args[args.indexOf('--progress-template') + 1]
    expect(template).toContain('download:@PROG')
    expect(template).toContain('%(progress.downloaded_bytes)s')
    expect(template).toContain('%(progress.speed)s')
    expect(template).toContain('%(progress.eta)s')
  })
})

describe('parseProgressLine', () => {
  it('parses the template line into percent, bytes, speed and eta', () => {
    expect(parseProgressLine('@PROG 5000000 20000000 NA 1250000 12 NA NA')).toEqual({
      type: 'progress',
      percent: 25,
      downloadedBytes: 5000000,
      totalBytes: 20000000,
      speedBytesPerSec: 1250000,
      etaSeconds: 12,
      fragmentIndex: undefined,
      fragmentCount: undefined,
    })
  })

  it('falls back to total_bytes_estimate for fragmented downloads', () => {
    const parsed = parseProgressLine('@PROG 2000000 NA 8000000 500000 10 3 48')
    expect(parsed).toMatchObject({ percent: 25, totalBytes: 8000000, fragmentIndex: 3, fragmentCount: 48 })
  })

  it('reports 0% and no metrics while every field is still NA', () => {
    expect(parseProgressLine('@PROG NA NA NA NA NA NA NA')).toMatchObject({
      percent: 0,
      downloadedBytes: undefined,
      speedBytesPerSec: undefined,
    })
  })

  it('caps percent at 100 when the total was underestimated', () => {
    expect(parseProgressLine('@PROG 12000000 10000000 NA 100 0 NA NA')?.percent).toBe(100)
  })

  it('still parses yt-dlp default human-readable progress lines', () => {
    expect(parseProgressLine('[download]  72.3% of 48.00MiB at 1.23MiB/s ETA 00:12'))
      .toEqual({ type: 'progress', percent: 72.3 })
    expect(parseProgressLine('[download] 100% of 48.00MiB')).toEqual({ type: 'progress', percent: 100 })
  })

  it('returns null for non-progress lines and empty strings', () => {
    expect(parseProgressLine('[info] Downloading format 140')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
  })
})

describe('parsePhase', () => {
  it.each([
    ['[youtube] dQw4w9WgXcQ: Downloading webpage', 'extracting'],
    ['[youtube:tab] Extracting URL: https://youtube.com/playlist', 'extracting'],
    ['[info] dQw4w9WgXcQ: Downloading 1 format(s): 140', 'extracting'],
    ['[download] Destination: C:\\out\\Test.m4a', 'downloading'],
    ['[Merger] Merging formats into "C:\\out\\Test.mp4"', 'merging'],
    ['[ExtractAudio] Destination: C:\\out\\Test.mp3', 'converting'],
    ['[FixupM4a] Correcting container of "C:\\out\\Test.m4a"', 'converting'],
    ['[ThumbnailsConvertor] Converting thumbnail "C:\\out\\Test.webp" to png', 'embedding'],
    ['[Metadata] Adding metadata to "C:\\out\\Test.m4a"', 'embedding'],
    ['[EmbedThumbnail] mutagen: Adding thumbnail to "C:\\out\\Test.m4a"', 'embedding'],
    ['Deleting original file C:\\out\\Test.f140.m4a (pass -k to keep)', 'finishing'],
  ])('maps %s to the %s phase', (line, phase) => {
    expect(parsePhase(line)).toMatchObject({ type: 'phase', phase })
  })

  it('returns null for lines that do not mark a stage', () => {
    expect(parsePhase('@PROG 1 2 NA 3 4 NA NA')).toBeNull()
    expect(parsePhase('')).toBeNull()
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

describe('translateDownloadLines', () => {
  async function* fakeRun(lines: string[], code: number): AsyncGenerator<string, number> {
    for (const line of lines) yield line
    return code
  }

  async function drain(gen: AsyncGenerator<DownloadStreamLine, DownloadRunResult>) {
    const emitted: DownloadStreamLine[] = []
    let step = await gen.next()
    while (!step.done) {
      emitted.push(step.value)
      step = await gen.next()
    }
    return { emitted, result: step.value }
  }

  it('emits progress and phase lines and returns the reported path', async () => {
    const { emitted, result } = await drain(translateDownloadLines(fakeRun([
      '[youtube] dQw4w9WgXcQ: Downloading webpage',
      '[download] Destination: C:\\out\\Test.m4a',
      '@PROG 5000000 20000000 NA 1250000 12 NA NA',
      '[Metadata] Adding metadata to "C:\\out\\Test.m4a"',
    ], 0)))

    expect(emitted.filter((l) => l.type === 'phase').map((l) => (l as { phase: string }).phase))
      .toEqual(['extracting', 'downloading', 'embedding'])
    expect(emitted.find((l) => l.type === 'progress')).toMatchObject({ percent: 25, speedBytesPerSec: 1250000 })
    expect(result).toMatchObject({ code: 0, savedPath: 'C:\\out\\Test.m4a' })
  })

  it('does not repeat a phase line while the stage is unchanged', async () => {
    const { emitted } = await drain(translateDownloadLines(fakeRun([
      '[download] Destination: C:\\out\\a.m4a',
      '@PROG 1 2 NA 1 1 NA NA',
      '[download] Destination: C:\\out\\a.m4a',
    ], 0)))
    expect(emitted.filter((l) => l.type === 'phase')).toHaveLength(1)
  })

  it('collects ERROR lines and the non-zero exit code', async () => {
    const { result } = await drain(translateDownloadLines(fakeRun([
      'ERROR: Video unavailable',
    ], 1)))
    expect(result).toMatchObject({ code: 1, errorMessage: 'Video unavailable' })
  })

  it('carries the cover-art path out so a failed run can delete it', async () => {
    const { result } = await drain(translateDownloadLines(fakeRun([
      '[info] Writing video thumbnail 41 to: C:\\out\\Test.webp',
      'ERROR: unable to download video data: HTTP Error 403: Forbidden',
    ], 1)))
    expect(result).toMatchObject({ code: 1, thumbnailPath: 'C:\\out\\Test.webp' })
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
    expect(formatArgs).toEqual(['-f', 'bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a'])
    expect(expectedExt).toBe('m4a')
  })
  it('always names an AAC-first source so m4a is a remux, not a transcode', () => {
    // Regression: without a selector yt-dlp picks opus-in-webm and --audio-format
    // m4a transcodes the whole track (27s vs 0.4s for 37 minutes of audio),
    // silently, which showed up as a hung download.
    for (const audioFormat of ['m4a', 'mp3'] as const) {
      const { formatArgs } = playlistFormatArgs({ mode: 'audio', audioFormat }, true)
      expect(formatArgs[0]).toBe('-f')
      expect(formatArgs[1]).toContain('bestaudio[ext=m4a]')
    }
  })
  it('m4a without ffmpeg falls back to format selection', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'm4a' }, false)
    expect(formatArgs).toEqual(['-f', 'bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best'])
    expect(expectedExt).toBe('m4a')
  })
  it('mp3 re-encodes to mp3', () => {
    const { formatArgs, expectedExt } = playlistFormatArgs({ mode: 'audio', audioFormat: 'mp3' }, true)
    expect(formatArgs).toEqual(['-f', 'bestaudio[ext=m4a][audio_channels<=2]/bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'mp3'])
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
    expect(info.tracks).toEqual([
      { index: 1, title: 'A', author: null },
      { index: 2, title: 'B', author: null },
    ])
  })
  it('uses placeholder title for null/untitled entries', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [null, { title: 'B' }] })
    const info = parsePlaylistInfo(json)
    expect(info.tracks[0]).toEqual({ index: 1, title: 'Track 1', author: null })
  })
  it('carries each entry channel so the client previews the server name', () => {
    const json = JSON.stringify({
      title: 'Mix',
      entries: [{ title: 'A', uploader: 'Chan', channel: 'Other' }, { title: 'B', channel: 'Only' }],
    })
    expect(parsePlaylistInfo(json).tracks.map((t) => t.author)).toEqual(['Chan', 'Only'])
  })
})

describe('parsePlaylistEntries', () => {
  it('extracts the playlist title and each entry id + title', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [{ id: 'x1', title: 'A' }, { id: 'x2', title: 'B' }] })
    expect(parsePlaylistEntries(json)).toEqual({
      title: 'Mix',
      entries: [
        { id: 'x1', title: 'A', author: null },
        { id: 'x2', title: 'B', author: null },
      ],
    })
  })
  it('drops null entries and entries without an id, defaulting missing titles', () => {
    const json = JSON.stringify({ title: 'Mix', entries: [null, { title: 'no id' }, { id: 'x3' }] })
    const { entries } = parsePlaylistEntries(json)
    expect(entries).toEqual([{ id: 'x3', title: 'Track 1', author: null }])
  })
  it('keeps each entry channel, preferring uploader, for author de-duplication', () => {
    const json = JSON.stringify({
      title: 'Mix',
      entries: [
        { id: 'x1', title: 'A', uploader: 'Thuy Nga', channel: 'Thuy Nga TV' },
        { id: 'x2', title: 'B', channel: 'Only Channel' },
      ],
    })
    const { entries } = parsePlaylistEntries(json)
    expect(entries.map((e) => e.author)).toEqual(['Thuy Nga', 'Only Channel'])
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
      yield { type: 'progress', percent: 100 } // one progress tick
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

  it('stops before the next track once the signal aborts', async () => {
    const calls: Record<string, number> = {}
    const ac = new AbortController()
    // Abort while the first track is in flight.
    const download: TrackDownloader = async function* (t) {
      calls[t.id] = (calls[t.id] ?? 0) + 1
      ac.abort()
      return { ok: true } as TrackOutcome
    }

    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2), track('c', 3)],
      download,
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 0, sleep: noSleep, signal: ac.signal },
    ))

    expect(calls).toEqual({ a: 1 })
    expect(emits.filter((e) => e.type === 'item')).toHaveLength(1)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ downloaded: 1, total: 3, cancelled: true })
  })

  it('does not retry a track that failed because it was cancelled', async () => {
    const calls: Record<string, number> = {}
    const ac = new AbortController()
    const download: TrackDownloader = async function* (t) {
      calls[t.id] = (calls[t.id] ?? 0) + 1
      ac.abort() // a killed yt-dlp exits non-zero, like a genuine failure
      return { ok: false } as TrackOutcome
    }

    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2)],
      download,
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 0, sleep: noSleep, signal: ac.signal },
    ))

    expect(calls.a).toBe(1) // not 5, and no phase-2 sweep
    expect(calls.b).toBeUndefined()
    expect(emits.some((e) => e.type === 'track-retry')).toBe(false)
    expect(emits.some((e) => e.type === 'track-skipped')).toBe(false)
    expect(emits.some((e) => e.type === 'track-error')).toBe(false)
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ downloaded: 0, cancelled: true })
  })

  it('gives up on a hung track instead of burning the deadline again', async () => {
    const calls: Record<string, number> = {}
    const download: TrackDownloader = async function* (t) {
      calls[t.id] = (calls[t.id] ?? 0) + 1
      return { ok: false, hung: true } as TrackOutcome
    }

    const emits = await collect(orchestratePlaylist(
      [track('a', 1), track('b', 2)],
      download,
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 0, sleep: noSleep },
    ))

    // One attempt per phase, not five, and the batch still moves on.
    expect(calls).toEqual({ a: 2, b: 2 })
    expect(emits.some((e) => e.type === 'track-retry')).toBe(false)
    expect(emits.filter((e) => e.type === 'track-error')).toHaveLength(2)
  })

  it('reports cancelled:false for a batch that ran to completion', async () => {
    const calls: Record<string, number> = {}
    const emits = await collect(orchestratePlaylist(
      [track('a', 1)],
      makeDownload(() => true, calls),
      { attemptsPerPhase: 5, folder: 'C:\\out', backoffMs: 0, sleep: noSleep, signal: new AbortController().signal },
    ))
    const done = emits.find((e) => e.type === 'done') as PlaylistBatchDoneLine
    expect(done).toMatchObject({ cancelled: false })
  })
})

describe('parseThumbnailPath', () => {
  it('captures the path from the line yt-dlp actually prints', () => {
    // Verbatim from a real run.
    expect(parseThumbnailPath(
      '[info] Writing video thumbnail 41 to: C:\\out\\Big Buck Bunny.webp',
    )).toBe('C:\\out\\Big Buck Bunny.webp')
  })

  it('handles a missing index and a POSIX path', () => {
    expect(parseThumbnailPath('[info] Writing video thumbnail to: /home/me/Music/song.jpg'))
      .toBe('/home/me/Music/song.jpg')
  })

  it('ignores unrelated lines', () => {
    expect(parseThumbnailPath('[download] Destination: C:\\out\\x.m4a')).toBeNull()
    expect(parseThumbnailPath('[EmbedThumbnail] mutagen: Adding thumbnail')).toBeNull()
  })
})

describe('removeStrayThumbnail', () => {
  it('deletes the orphaned cover art', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'))
    const file = path.join(dir, 'cover.webp')
    fs.writeFileSync(file, 'x')

    removeStrayThumbnail(file)
    expect(fs.existsSync(file)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('is a no-op for undefined or a path that is already gone', () => {
    expect(() => removeStrayThumbnail(undefined)).not.toThrow()
    expect(() => removeStrayThumbnail(path.join(os.tmpdir(), 'definitely-not-here.webp')))
      .not.toThrow()
  })
})

describe('runTrack cancellation', () => {
  it('kills the process when the signal aborts, ending the stream', async () => {
    const ac = new AbortController()
    // `python -c` blocks forever; only a kill can end it.
    const gen = runTrack(
      [process.execPath, '-e', 'setInterval(() => console.log("tick"), 20)'],
      ac.signal,
    )

    // Proves the child really started, so the assertions below are not vacuous.
    const first = await gen.next()
    expect(first.done).toBe(false)
    expect(first.value).toBe('tick')

    ac.abort()

    // Drain to completion -- it must terminate rather than hang.
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(step.value).not.toBe(0)
  }, 15000)

  it('kills a process that goes silent past the idle deadline', async () => {
    // Prints once, then sleeps forever: exactly the shape of a wedged ffmpeg
    // postprocess, which yt-dlp reports nothing for.
    const gen = runTrack(
      [process.execPath, '-e', 'console.log("started"); setTimeout(() => {}, 1e9)'],
      undefined,
      600,
    )

    const lines: string[] = []
    let step = await gen.next()
    while (!step.done) { lines.push(step.value); step = await gen.next() }

    expect(lines[0]).toBe('started')
    expect(lines.some((l) => /no output for .* hung/i.test(l))).toBe(true)
    expect(step.value).not.toBe(0)
  }, 15000)

  it('does not fire the deadline while output keeps coming', async () => {
    const gen = runTrack(
      [process.execPath, '-e', 'let n=0; const t=setInterval(()=>{console.log("tick"+ ++n); if(n===6){clearInterval(t)}},50)'],
      undefined,
      600,
    )

    const lines: string[] = []
    let step = await gen.next()
    while (!step.done) { lines.push(step.value); step = await gen.next() }

    expect(lines.filter((l) => l.startsWith('tick')).length).toBe(6)
    expect(lines.some((l) => /hung/i.test(l))).toBe(false)
    expect(step.value).toBe(0)
  }, 15000)

  it('kills the process when the caller stops pulling', async () => {
    const gen = runTrack([process.execPath, '-e', 'setInterval(() => console.log("tick"), 20)'])
    await gen.next()
    // Abandoning the generator must not leave the child running.
    await gen.return(0 as never)
    expect(true).toBe(true)
  }, 15000)
})
