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

const origPlatform = process.platform
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('POST /api/ffmpeg/install', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true }))

  it('streams a winget install on Windows', async () => {
    setPlatform('win32')
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('winget')
        ? { stdout: 'v1.7.0', stderr: '', code: 0 }
        : { stdout: '', stderr: 'not found', code: 1 })
    mockStream.mockReturnValue(fakeStream(['Found Gyan.FFmpeg', 'Successfully installed']))

    const text = await (await POST()).text()
    expect(text).toContain('winget')
    expect(text).toContain('Successfully installed')
    expect(mockStream.mock.calls[0][0]).toContain('Gyan.FFmpeg')
  })

  it('falls back to Chocolatey on Windows when winget is absent', async () => {
    setPlatform('win32')
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('choco')
        ? { stdout: '2.2.2', stderr: '', code: 0 }
        : { stdout: '', stderr: 'not found', code: 1 })
    mockStream.mockReturnValue(fakeStream(['Chocolatey installing ffmpeg']))

    const text = await (await POST()).text()
    expect(text).toContain('Chocolatey')
    expect(mockStream.mock.calls[0][0]).toEqual(['choco', 'install', 'ffmpeg', '-y'])
  })

  it('guides manual install on Windows when neither package manager exists', async () => {
    setPlatform('win32')
    mockExec.mockResolvedValue({ stdout: '', stderr: 'not found', code: 1 })

    const text = await (await POST()).text()
    expect(text.toLowerCase()).toContain('gyan.dev')
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('installs via Homebrew on macOS', async () => {
    setPlatform('darwin')
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('brew') ? { stdout: '4.0', stderr: '', code: 0 } : { stdout: '', stderr: '', code: 1 })
    mockStream.mockReturnValue(fakeStream(['==> Pouring ffmpeg']))

    const text = await (await POST()).text()
    expect(mockStream.mock.calls[0][0]).toEqual(['brew', 'install', 'ffmpeg'])
    expect(text).toContain('Homebrew')
  })

  it('guides a Fedora (dnf) install on Linux without running sudo', async () => {
    setPlatform('linux')
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('dnf') ? { stdout: '4.18', stderr: '', code: 0 } : { stdout: '', stderr: 'not found', code: 1 })

    const text = await (await POST()).text()
    expect(text).toContain('sudo dnf install ffmpeg')
    expect(text).toContain('RPM Fusion')
    expect(mockStream).not.toHaveBeenCalled()
  })

  it('guides an apt install on Debian/Ubuntu Linux', async () => {
    setPlatform('linux')
    mockExec.mockImplementation(async (cmd: string) =>
      cmd.startsWith('apt-get') ? { stdout: '2.4', stderr: '', code: 0 } : { stdout: '', stderr: 'not found', code: 1 })

    const text = await (await POST()).text()
    expect(text).toContain('sudo apt install ffmpeg')
    expect(mockStream).not.toHaveBeenCalled()
  })
})
