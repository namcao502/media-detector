import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  ensureOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  resolveOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
  parseProgress: jest.requireActual('@/lib/ytdlp').parseProgress,
  parseDestination: jest.requireActual('@/lib/ytdlp').parseDestination,
}))
jest.mock('@/lib/validate', () => ({
  isYouTubeUrl: jest.fn().mockReturnValue(true),
}))

import { streamCommand, ensureOutputDir } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockEnsureDir = ensureOutputDir as jest.MockedFunction<typeof ensureOutputDir>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('POST /api/download', () => {
  beforeEach(() => jest.clearAllMocks())

  it('streams progress lines and done event', async () => {
    mockEnsureDir.mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector')
    mockStream.mockReturnValue(
      fakeStream([
        '[download] Destination: C:\\Users\\test\\Documents\\MediaDetector\\Test.m4a',
        '[download]  50.0% of 48.00MiB at 1.23MiB/s ETA 00:20',
        '[download] 100% of 48.00MiB at 1.23MiB/s ETA 00:00',
      ])
    )

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

  it('emits error line when streamCommand throws', async () => {
    mockStream.mockReturnValue(
      (async function* () {
        throw new Error('yt-dlp crashed')
      })()
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
