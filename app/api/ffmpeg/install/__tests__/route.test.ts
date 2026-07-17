import { POST } from '../route'

jest.mock('@/lib/ytdlp', () => ({
  streamCommand: jest.fn(),
  execCommand: jest.fn(),
}))

import { streamCommand, execCommand } from '@/lib/ytdlp'
const mockStream = streamCommand as jest.MockedFunction<typeof streamCommand>
const mockExec = execCommand as jest.MockedFunction<typeof execCommand>

async function* fakeStream(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('POST /api/ffmpeg/install', () => {
  beforeEach(() => jest.clearAllMocks())

  it('streams a winget install when winget is available', async () => {
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('winget')
        ? { stdout: 'v1.7.0', stderr: '', code: 0 }
        : { stdout: '', stderr: 'not found', code: 1 })
    mockStream.mockReturnValue(fakeStream(['Found Gyan.FFmpeg', 'Successfully installed']))

    const res = await POST()
    const text = await res.text()

    expect(text).toContain('winget')
    expect(text).toContain('Successfully installed')
    expect(mockStream.mock.calls[0][0]).toContain('Gyan.FFmpeg')
  })

  it('falls back to Chocolatey when winget is absent', async () => {
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('choco')
        ? { stdout: '2.2.2', stderr: '', code: 0 }
        : { stdout: '', stderr: 'not found', code: 1 })
    mockStream.mockReturnValue(fakeStream(['Chocolatey installing ffmpeg']))

    const res = await POST()
    const text = await res.text()

    expect(text).toContain('Chocolatey')
    expect(mockStream.mock.calls[0][0]).toEqual(['choco', 'install', 'ffmpeg', '-y'])
  })

  it('guides manual install when neither package manager exists', async () => {
    mockExec.mockResolvedValue({ stdout: '', stderr: 'not found', code: 1 })

    const res = await POST()
    const text = await res.text()

    expect(text.toLowerCase()).toContain('gyan.dev')
    expect(mockStream).not.toHaveBeenCalled()
  })
})
