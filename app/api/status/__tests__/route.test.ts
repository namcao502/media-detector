import { GET, resetStatusCache } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execCommand: jest.fn(),
  checkFfmpeg: jest.fn().mockResolvedValue({ found: true, version: '7.1' }),
  isExternallyManaged: jest.requireActual('@/lib/ytdlp').isExternallyManaged,
}))

import { execCommand, checkFfmpeg } from '@/lib/ytdlp'
const mockExec = execCommand as jest.MockedFunction<typeof execCommand>
const mockFfmpeg = checkFfmpeg as jest.MockedFunction<typeof checkFfmpeg>

beforeEach(() => {
  jest.clearAllMocks()
  resetStatusCache()
  mockFfmpeg.mockResolvedValue({ found: true, version: '7.1' })
})

describe('GET /api/status', () => {
  it('returns python and ytdlp info when both are installed and already current', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Python 3.12.2', stderr: '', code: 0 }) // python --version
      .mockResolvedValueOnce({ stdout: '2025.04.15', stderr: '', code: 0 })    // yt-dlp --version
      .mockResolvedValueOnce({ stdout: 'Requirement already satisfied: yt-dlp', stderr: '', code: 0 }) // pip upgrade

    const res = await GET(new Request('http://localhost/api/status'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.python.found).toBe(true)
    expect(body.python.version).toBe('3.12.2')
    expect(body.ytdlp.found).toBe(true)
    expect(body.ytdlp.version).toBe('2025.04.15')
    expect(body.ytdlp.updateStatus).toBe('up-to-date')
    expect(body.ffmpeg).toEqual({ found: true, version: '7.1' })
  })

  it('reports ffmpeg as not found when missing', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Python 3.12.2', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: '2025.04.15', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: 'Requirement already satisfied: yt-dlp', stderr: '', code: 0 })
    mockFfmpeg.mockResolvedValue({ found: false, version: null })

    const res = await GET(new Request('http://localhost/api/status'))
    const body = await res.json()
    expect(body.ffmpeg.found).toBe(false)
  })

  it('reports updated when pip installs a newer yt-dlp', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: 'Python 3.12.2', stderr: '', code: 0 }) // python --version
      .mockResolvedValueOnce({ stdout: '2025.04.15', stderr: '', code: 0 })    // yt-dlp --version
      .mockResolvedValueOnce({ stdout: 'Successfully installed yt-dlp-2026.07.04', stderr: '', code: 0 }) // pip upgrade

    const res = await GET(new Request('http://localhost/api/status'))
    const body = await res.json()
    expect(body.ytdlp.updateStatus).toBe('updated')
  })

  it('returns found: false when python is missing', async () => {
    mockExec
      .mockResolvedValueOnce({ stdout: '', stderr: 'command not found', code: 1 }) // python
      .mockResolvedValueOnce({ stdout: '', stderr: 'command not found', code: 1 }) // python3

    const res = await GET(new Request('http://localhost/api/status'))
    const body = await res.json()

    expect(body.python.found).toBe(false)
    expect(body.ytdlp.updateStatus).toBe('skipped')
  })
})
