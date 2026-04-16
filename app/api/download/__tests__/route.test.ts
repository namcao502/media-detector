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
const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockEnsureDir = ensureOutputDir as jest.MockedFunction<typeof ensureOutputDir>

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
    const { isYouTubeUrl } = require('@/lib/validate')
    isYouTubeUrl.mockReturnValueOnce(false)

    const req = new Request('http://localhost/api/download', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vimeo.com/x', formatId: '140', title: 'Test', ext: 'm4a' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
