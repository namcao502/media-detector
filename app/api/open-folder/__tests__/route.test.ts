import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
}))

import { execArgs } from '@/lib/ytdlp'
const mockExec = execArgs as jest.MockedFunction<typeof execArgs>

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
    expect(mockExec).toHaveBeenCalledWith(['explorer.exe', expect.stringContaining('MediaDetector')])
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

  it('returns 500 when explorer.exe fails', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: 'Access denied', code: 1 })

    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\Users\\test\\Documents\\MediaDetector' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('denied')
  })
})
