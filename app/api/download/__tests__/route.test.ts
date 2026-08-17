import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  runDownload: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  resolveOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  progressTemplateArgs: jest.requireActual('@/lib/ytdlp').progressTemplateArgs,
  checkFfmpeg: jest.fn().mockResolvedValue({ found: false, version: null }),
  metadataArgs: jest.requireActual('@/lib/ytdlp').metadataArgs,
  ffmpegLocationArgs: jest.requireActual('@/lib/ytdlp').ffmpegLocationArgs,
  ytdlpArgs: jest.fn((...args: string[]) => Promise.resolve(['python', '-m', 'yt_dlp', ...args])),
  removeStrayThumbnail: jest.fn(),
}))
jest.mock('@/lib/validate', () => ({
  isYouTubeUrl: jest.fn().mockReturnValue(true),
}))

import {
  runDownload, ensureOutputDir, checkFfmpeg, translateDownloadLines, removeStrayThumbnail,
} from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockRun = runDownload as jest.MockedFunction<typeof runDownload>
const mockRemoveStray = removeStrayThumbnail as jest.MockedFunction<typeof removeStrayThumbnail>
const mockEnsureDir = ensureOutputDir as jest.MockedFunction<typeof ensureOutputDir>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>
const mockFfmpeg = checkFfmpeg as jest.MockedFunction<typeof checkFfmpeg>

const realTranslate: typeof translateDownloadLines = jest.requireActual('@/lib/ytdlp').translateDownloadLines

// Feeds raw yt-dlp lines through the real translator so the route test exercises
// the actual progress/phase parsing rather than hand-built stream lines.
function fakeRun(lines: string[], code = 0) {
  async function* source(): AsyncGenerator<string, number> {
    for (const line of lines) yield line
    return code
  }
  return realTranslate(source())
}

describe('POST /api/download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('streams progress lines and done event', async () => {
    mockEnsureDir.mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector')
    mockRun.mockReturnValue(fakeRun([
      '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Test.m4a',
      '@PROG 24000000 48000000 NA 1290000 20 NA NA',
      '@PROG 48000000 48000000 NA 1290000 0 NA NA',
    ]))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))

    const progressLine = lines.find((l) => l.type === 'progress' && l.percent === 50)
    expect(progressLine).toBeDefined()

    const doneLine = lines.find((l) => l.type === 'done')
    expect(doneLine).toBeDefined()
    expect(doneLine.savedPath).toContain('MediaDetector')
  })

  it('streams speed, ETA and byte counters with each progress line', async () => {
    mockRun.mockReturnValue(fakeRun(['@PROG 24000000 48000000 NA 1290000 20 3 48']))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const lines = (await (await POST(req)).text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'progress')).toMatchObject({
      percent: 50,
      downloadedBytes: 24000000,
      totalBytes: 48000000,
      speedBytesPerSec: 1290000,
      etaSeconds: 20,
      fragmentIndex: 3,
      fragmentCount: 48,
    })
  })

  it('streams a phase line for each postprocessing stage', async () => {
    mockRun.mockReturnValue(fakeRun([
      '[youtube] x: Downloading webpage',
      '[download] Destination: C:\\out\\Test.mp4',
      '[Merger] Merging formats into "C:\\out\\Test.mp4"',
      '[EmbedThumbnail] mutagen: Adding thumbnail to "C:\\out\\Test.mp4"',
    ]))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '137', title: 'Test', ext: 'mp4' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const lines = (await (await POST(req)).text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.filter((l) => l.type === 'phase').map((l) => l.phase))
      .toEqual(['extracting', 'downloading', 'merging', 'embedding'])
  })

  it('requests machine-readable progress from yt-dlp', async () => {
    mockRun.mockReturnValue(fakeRun([]))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    const args = mockRun.mock.calls[0][0]
    expect(args).toContain('--newline')
    expect(args).toContain('--progress-template')
  })

  // yt-dlp downloads the cover art to a sibling file and deletes it only after
  // embedding, so a run that dies in between orphans it.
  const THUMB_LINE = '[info] Writing video thumbnail 41 to: C:\\out\\Test.webp'

  function downloadReq(body: Record<string, unknown> = {}) {
    return new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a', ...body,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('deletes the orphaned cover art when the download fails', async () => {
    mockRun.mockReturnValue(fakeRun([THUMB_LINE, 'ERROR: HTTP Error 403: Forbidden'], 1))
    await (await POST(downloadReq())).text()
    expect(mockRemoveStray).toHaveBeenCalledWith('C:\\out\\Test.webp')
  })

  it('leaves the cover art alone when the download succeeds', async () => {
    mockRun.mockReturnValue(fakeRun([THUMB_LINE, '[download] Destination: C:\\out\\Test.m4a'], 0))
    await (await POST(downloadReq())).text()
    expect(mockRemoveStray).not.toHaveBeenCalled()
  })

  it('uses a filename typed in the preview, sanitized', async () => {
    mockRun.mockReturnValue(fakeRun([], 0))
    await (await POST(downloadReq({ filename: 'My Own Name' }))).text()
    const args = mockRun.mock.calls[0][0]
    expect(args[args.indexOf('-o') + 1]).toContain('My Own Name')
  })

  it('cannot be made to write outside the download folder', async () => {
    mockRun.mockReturnValue(fakeRun([], 0))
    await (await POST(downloadReq({ filename: '../../../escaped' }))).text()
    const args = mockRun.mock.calls[0][0]
    const output = args[args.indexOf('-o') + 1]
    // Only the folder's own separators may remain.
    expect(output.startsWith('C:\\Users\\test\\Documents\\MediaDetector\\')).toBe(true)
    expect(output.slice('C:\\Users\\test\\Documents\\MediaDetector\\'.length)).not.toMatch(/[/\\]/)
  })

  it('falls back to the generated name when the typed one is blank', async () => {
    mockRun.mockReturnValue(fakeRun([], 0))
    await (await POST(downloadReq({ filename: '   ', channel: 'Chan' }))).text()
    const args = mockRun.mock.calls[0][0]
    expect(args[args.indexOf('-o') + 1]).toContain('Test - Chan')
  })

  it('emits an error instead of done when yt-dlp exits non-zero', async () => {
    mockRun.mockReturnValue(fakeRun(['ERROR: Video unavailable'], 1))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const lines = (await (await POST(req)).text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'done')).toBeUndefined()
    expect(lines.find((l) => l.type === 'error').message).toContain('Video unavailable')
  })

  it('adds metadata embed flags when ffmpeg is present', async () => {
    mockFfmpeg.mockResolvedValueOnce({ found: true, version: '7.1' })
    mockRun.mockReturnValue(fakeRun(['@PROG 1000000 1000000 NA 500000 0 NA NA']))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    const args = mockRun.mock.calls[0][0]
    expect(args).toContain('--embed-metadata')
    expect(args).toContain('--embed-thumbnail')
  })

  it('omits metadata flags when ffmpeg is absent', async () => {
    mockFfmpeg.mockResolvedValueOnce({ found: false, version: null })
    mockRun.mockReturnValue(fakeRun(['@PROG 1000000 1000000 NA 500000 0 NA NA']))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    expect(mockRun.mock.calls[0][0]).not.toContain('--embed-metadata')
  })

  it('skips the thumbnail flag for a webm format (unsupported container)', async () => {
    mockFfmpeg.mockResolvedValueOnce({ found: true, version: '7.1' })
    mockRun.mockReturnValue(fakeRun(['@PROG 1000000 1000000 NA 500000 0 NA NA']))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '251', title: 'Test', ext: 'webm' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    const args = mockRun.mock.calls[0][0]
    expect(args).toContain('--embed-metadata')
    expect(args).not.toContain('--embed-thumbnail')
  })

  it('passes a body-supplied outputDir to ensureOutputDir', async () => {
    mockRun.mockReturnValue(fakeRun(['@PROG 1000000 1000000 NA 500000 0 NA NA']))

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a', outputDir: 'D:\\Music' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    expect(mockEnsureDir).toHaveBeenCalledWith('D:\\Music')
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vimeo.com/x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when formatId is missing', async () => {
    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Missing')
  })

  it('emits error line when the download generator throws', async () => {
    mockRun.mockReturnValue(
      (async function* () {
        throw new Error('yt-dlp crashed')
      })() as ReturnType<typeof runDownload>
    )

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const text = await res.text()
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))
    const errorLine = lines.find((l) => l.type === 'error')
    expect(errorLine).toBeDefined()
    expect(errorLine.message).toContain('crashed')
  })
})
