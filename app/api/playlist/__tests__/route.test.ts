import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
  parsePlaylistInfo: jest.requireActual('@/lib/ytdlp').parsePlaylistInfo,
  ytdlpArgs: jest.fn((...args: string[]) => Promise.resolve(['python', '-m', 'yt_dlp', ...args])),
}))
jest.mock('@/lib/validate', () => ({ isYouTubeUrl: jest.fn().mockReturnValue(true) }))

import { execArgs } from '@/lib/ytdlp'
import { isYouTubeUrl } from '@/lib/validate'

const mockExec = execArgs as jest.MockedFunction<typeof execArgs>
const mockIsYouTubeUrl = isYouTubeUrl as jest.MockedFunction<typeof isYouTubeUrl>

function req(body: unknown) {
  return new Request('http://localhost/api/playlist', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/playlist', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns parsed playlist info', async () => {
    mockExec.mockResolvedValue({
      stdout: JSON.stringify({ title: 'My Mix', entries: [{ title: 'A' }, { title: 'B' }] }),
      stderr: '', code: 0,
    })
    const res = await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('My Mix')
    expect(body.count).toBe(2)
    expect(body.tracks[0]).toEqual({ index: 1, title: 'A' })
  })

  it('returns 400 for invalid URL', async () => {
    mockIsYouTubeUrl.mockReturnValueOnce(false)
    expect((await POST(req({ url: 'https://vimeo.com/x' }))).status).toBe(400)
  })

  it('returns 422 when yt-dlp fails', async () => {
    mockExec.mockResolvedValue({ stdout: '', stderr: 'ERROR: unavailable', code: 1 })
    expect((await POST(req({ url: 'https://youtube.com/playlist?list=PL1' }))).status).toBe(422)
  })
})
