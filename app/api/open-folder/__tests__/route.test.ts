import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execCommand: jest.fn(),
}))

import { execCommand } from '@/lib/ytdlp'
const mockExec = execCommand as jest.MockedFunction<typeof execCommand>

describe('POST /api/open-folder', () => {
  beforeEach(() => jest.clearAllMocks())

  it('opens the folder and returns 200', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })

    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\Users\\test\\Documents\\MediaDetector' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('MediaDetector')
    )
  })

  it('returns 400 when path is missing', async () => {
    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
