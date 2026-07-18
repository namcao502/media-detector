import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  reducePlaylistLine: jest.requireActual('@/lib/ytdlp').reducePlaylistLine,
  finalizePlaylist: jest.requireActual('@/lib/ytdlp').finalizePlaylist,
  initialPlaylistState: jest.requireActual('@/lib/ytdlp').initialPlaylistState,
  checkFfmpeg: jest.fn().mockResolvedValue({ found: false, version: null }),
  metadataArgs: jest.requireActual('@/lib/ytdlp').metadataArgs,
  ffmpegLocationArgs: jest.requireActual('@/lib/ytdlp').ffmpegLocationArgs,
  ytdlpArgs: jest.fn((...args: string[]) => Promise.resolve(['python', '-m', 'yt_dlp', ...args])),
}))
jest.mock('@/lib/validate', () => ({ isYouTubeUrl: jest.fn().mockReturnValue(true) }))

import { streamCommand, checkFfmpeg } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>
const mockFfmpeg = checkFfmpeg as jest.MockedFunction<typeof checkFfmpeg>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}
function req(body: unknown) {
  return new Request('http://localhost/api/playlist/download', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/playlist/download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('emits item, track-done, and done summary', async () => {
    mockStream.mockReturnValue(fakeStream([
      '[download] Downloading item 1 of 2',
      '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Mix\\01 - A.m4a',
      '[download] 100% of 3.00MiB',
      '[download] Downloading item 2 of 2',
      '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Mix\\02 - B.m4a',
      '[download] 100% of 3.00MiB',
    ]))
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    expect(res.status).toBe(200)
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'item' && l.index === 1 && l.total === 2)).toBeDefined()
    expect(lines.filter((l) => l.type === 'track-done')).toHaveLength(2)
    const done = lines.find((l) => l.type === 'done')
    expect(done.downloaded).toBe(2)
    expect(done.total).toBe(2)
    expect(done.folder).toContain('Mix')
  })

  it('adds metadata embed flags when ffmpeg is present', async () => {
    mockFfmpeg.mockResolvedValueOnce({ found: true, version: '7.1' })
    mockStream.mockReturnValue(fakeStream(['[download] Downloading item 1 of 1']))
    await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    const args = mockStream.mock.calls[0][0]
    expect(args).toContain('--embed-metadata')
    expect(args).toContain('--embed-thumbnail')
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)
    expect((await POST(req({ url: 'https://vimeo.com/x' }))).status).toBe(400)
  })

  it('emits error line when streamCommand throws', async () => {
    mockStream.mockReturnValue((async function* () { throw new Error('yt-dlp crashed') })())
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.find((l) => l.type === 'error').message).toContain('crashed')
  })
})
