import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  pipArgs: jest.fn().mockResolvedValue(['python', '-m', 'pip', 'install', 'yt-dlp', 'mutagen']),
}))

import { streamCommand, pipArgs } from '@/lib/ytdlp'
const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockPipArgs = pipArgs as jest.MockedFunction<typeof pipArgs>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('POST /api/ytdlp/install', () => {
  beforeEach(() => jest.clearAllMocks())

  it('streams pip install output', async () => {
    mockStream.mockReturnValue(fakeStream(['Collecting yt-dlp', 'Successfully installed yt-dlp-2025.04.15']))

    const res = await POST()

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Successfully installed')
    expect(mockPipArgs).toHaveBeenCalledWith('install', 'yt-dlp', 'mutagen')
  })
})
