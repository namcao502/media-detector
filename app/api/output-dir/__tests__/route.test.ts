import { GET } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  resolveOutputDir: jest.fn().mockReturnValue('C:\\Users\\test\\Documents\\MediaDetector'),
}))

describe('GET /api/output-dir', () => {
  it('returns the resolved default download dir', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dir).toBe('C:\\Users\\test\\Documents\\MediaDetector')
  })
})
