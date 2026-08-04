import { POST, openFolderArgs } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  execArgs: jest.fn(),
}))

import { execArgs } from '@/lib/ytdlp'
const mockExec = execArgs as jest.MockedFunction<typeof execArgs>

describe('openFolderArgs', () => {
  it('uses explorer.exe on Windows', () => {
    expect(openFolderArgs('/p', 'win32')).toEqual(['explorer.exe', '/p'])
  })
  it('uses open on macOS', () => {
    expect(openFolderArgs('/p', 'darwin')).toEqual(['open', '/p'])
  })
  it('uses xdg-open on Linux (Fedora KDE, GNOME, etc.)', () => {
    expect(openFolderArgs('/p', 'linux')).toEqual(['xdg-open', '/p'])
  })
})

describe('POST /api/open-folder', () => {
  beforeEach(() => jest.clearAllMocks())

  it('opens the folder and returns 200', async () => {
    mockExec.mockResolvedValueOnce({ stdout: '', stderr: '', code: 0 })

    const folder = 'C:\\Users\\test\\Documents\\MediaDetector'
    const req = new Request('http://localhost/api/open-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folder }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    // platform-agnostic: matches whatever host the tests run on
    expect(mockExec).toHaveBeenCalledWith(openFolderArgs(folder))
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
