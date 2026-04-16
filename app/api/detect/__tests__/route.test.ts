import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
  parseMediaInfo: jest.requireActual('@/lib/ytdlp').parseMediaInfo,
}))

import { execArgs } from '@/lib/ytdlp'
const mockExec = execArgs as jest.MockedFunction<typeof execArgs>

const sampleDump = JSON.stringify({
  title: 'Test Video',
  uploader: 'Test Channel',
  duration: 212,
  thumbnail: 'https://example.com/thumb.jpg',
  view_count: 1000,
  formats: [
    { format_id: '137', ext: 'mp4', width: 1920, height: 1080, fps: 30, vcodec: 'avc1', acodec: 'none', filesize: 2400000000 },
    { format_id: '140', ext: 'm4a', width: null, height: null, fps: null, vcodec: 'none', acodec: 'mp4a', abr: 128, filesize: 48000000 },
  ],
})

describe('POST /api/detect', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns media info for a valid YouTube URL', async () => {
    mockExec.mockResolvedValueOnce({ stdout: sampleDump, stderr: '', code: 0 })

    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.title).toBe('Test Video')
    expect(body.videoFormats).toHaveLength(1)
    expect(body.audioFormats).toHaveLength(1)
  })

  it('returns 400 for a non-YouTube URL', async () => {
    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://vimeo.com/123' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/YouTube/)
  })

  it('returns 422 when yt-dlp reports an error', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'ERROR: Video unavailable', code: 1 })

    const req = new Request('http://localhost/api/detect', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=invalid' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toContain('unavailable')
  })
})
