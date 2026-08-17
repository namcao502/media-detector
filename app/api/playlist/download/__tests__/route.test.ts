import { POST } from '../route'
import type { PlaylistDownloadLine } from '@/types/media'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\out'),
  checkFfmpeg: jest.fn().mockResolvedValue({ found: false, version: null }),
  metadataArgs: jest.fn().mockReturnValue([]),
  ffmpegLocationArgs: jest.fn().mockReturnValue([]),
  ytdlpArgs: jest.fn((...args: string[]) => Promise.resolve(['python', '-m', 'yt_dlp', ...args])),
  playlistFormatArgs: jest.fn().mockReturnValue({ formatArgs: ['-x', '--audio-format', 'm4a'], expectedExt: 'm4a' }),
  parsePlaylistEntries: jest.fn().mockReturnValue({ title: 'Mix', entries: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }),
  sanitizeFolderName: jest.fn((s: string) => s),
  runDownload: jest.fn(),
  progressTemplateArgs: jest.fn().mockReturnValue(['--newline', '--progress-template', 'download:@PROG']),
  orchestratePlaylist: jest.fn(),
}))
jest.mock('@/lib/validate', () => ({ isYouTubeUrl: jest.fn().mockReturnValue(true) }))

import { execArgs, ensureOutputDir, playlistFormatArgs, parsePlaylistEntries, orchestratePlaylist } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockExecArgs = execArgs as jest.MockedFunction<typeof execArgs>
const mockEnsureDir = ensureOutputDir as jest.MockedFunction<typeof ensureOutputDir>
const mockFormatArgs = playlistFormatArgs as jest.MockedFunction<typeof playlistFormatArgs>
const mockParseEntries = parsePlaylistEntries as jest.MockedFunction<typeof parsePlaylistEntries>
const mockOrchestrate = orchestratePlaylist as jest.MockedFunction<typeof orchestratePlaylist>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>

async function* fakeLines(lines: PlaylistDownloadLine[]): AsyncGenerator<PlaylistDownloadLine> {
  for (const line of lines) yield line
}
function req(body: unknown) {
  return new Request('http://localhost/api/playlist/download', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}
async function readLines(res: Response) {
  return (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

const okDump = { stdout: '{"title":"Mix"}', stderr: '', code: 0 }

describe('POST /api/playlist/download', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEnsureDir.mockReturnValue('C:\\out')
    mockFormatArgs.mockReturnValue({ formatArgs: ['-x', '--audio-format', 'm4a'], expectedExt: 'm4a' })
    mockParseEntries.mockReturnValue({ title: 'Mix', entries: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] })
  })

  it('flat-dumps the playlist and streams orchestrator lines', async () => {
    mockExecArgs.mockResolvedValue(okDump)
    mockOrchestrate.mockReturnValue(fakeLines([
      { type: 'item', index: 1, total: 2 },
      { type: 'phase', phase: 'downloading', label: 'Downloading' },
      { type: 'progress', percent: 50, speedBytesPerSec: 1250000, etaSeconds: 12 },
      { type: 'track-done', index: 1, savedPath: 'C:\\out\\Mix\\A.m4a' },
      { type: 'track-error', index: 2, title: 'B' },
      { type: 'done', folder: 'C:\\out\\Mix', downloaded: 1, total: 2, failed: 1 },
    ]))

    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    expect(res.status).toBe(200)
    // the flat-playlist dump ran
    expect(mockExecArgs.mock.calls[0][0]).toEqual(expect.arrayContaining(['--flat-playlist', '--dump-single-json']))
    const lines = await readLines(res)
    expect(lines.find((l) => l.type === 'phase')).toMatchObject({ label: 'Downloading' })
    expect(lines.find((l) => l.type === 'progress')).toMatchObject({ speedBytesPerSec: 1250000, etaSeconds: 12 })
    expect(lines.find((l) => l.type === 'track-done' && l.index === 1)).toBeDefined()
    expect(lines.find((l) => l.type === 'track-error' && l.index === 2)).toBeDefined()
    expect(lines.find((l) => l.type === 'done' && l.failed === 1)).toBeDefined()
  })

  it('passes a body-supplied outputDir to ensureOutputDir', async () => {
    mockExecArgs.mockResolvedValue(okDump)
    mockOrchestrate.mockReturnValue(fakeLines([]))
    await POST(req({ url: 'https://youtube.com/playlist?list=PL1', outputDir: 'D:\\Music' }))
    expect(mockEnsureDir).toHaveBeenCalledWith('D:\\Music')
  })

  it('parses the format selection and forwards it to playlistFormatArgs', async () => {
    mockExecArgs.mockResolvedValue(okDump)
    mockOrchestrate.mockReturnValue(fakeLines([]))
    await POST(req({ url: 'https://youtube.com/playlist?list=PL1', mode: 'video', videoQuality: '720' }))
    expect(mockFormatArgs).toHaveBeenCalledWith(
      { mode: 'video', audioFormat: 'm4a', videoQuality: '720' },
      false,
    )
  })

  it('emits an error line when the flat-playlist dump fails', async () => {
    mockExecArgs.mockResolvedValue({ stdout: '', stderr: 'ERROR: playlist gone', code: 1 })
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    const lines = await readLines(res)
    expect(lines.find((l) => l.type === 'error').message).toContain('playlist gone')
    expect(mockOrchestrate).not.toHaveBeenCalled()
  })

  it('emits an error line when the playlist has no tracks', async () => {
    mockExecArgs.mockResolvedValue(okDump)
    mockParseEntries.mockReturnValue({ title: 'Mix', entries: [] })
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    const lines = await readLines(res)
    expect(lines.find((l) => l.type === 'error')).toBeDefined()
    expect(mockOrchestrate).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)
    expect((await POST(req({ url: 'https://vimeo.com/x' }))).status).toBe(400)
  })
})
