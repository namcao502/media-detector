import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlaylistPanel from '../PlaylistPanel'
import type { PlaylistInfo } from '@/types/media'

const info: PlaylistInfo = {
  title: 'My Mix',
  count: 3,
  tracks: [
    { index: 1, title: 'Song A', author: 'Chan' },
    { index: 2, title: 'Song B', author: 'Chan' },
    { index: 3, title: 'Song C', author: 'Chan' },
  ],
}

const PL_URL = 'https://youtube.com/playlist?list=PL1'
const DIR = 'C:\\dl'

describe('PlaylistPanel', () => {
  it('renders playlist title, track count, and track titles', () => {
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
    expect(screen.getByText('My Mix')).toBeInTheDocument()
    expect(screen.getByText(/3 tracks/)).toBeInTheDocument()
    expect(screen.getByText(/Song A/)).toBeInTheDocument()
    expect(screen.getByText(/Song C/)).toBeInTheDocument()
  })

  it('posts the audio selection and folder when Download all audio is clicked', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
    fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlist/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: PL_URL, outputDir: DIR, mode: 'audio', audioFormat: 'm4a', videoQuality: '1080', cleanNames: true, names: {} }),
      }),
    )
  })

  it('posts mode:video after switching to the Video tab', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
    fireEvent.click(screen.getByRole('button', { name: 'video' }))
    fireEvent.click(screen.getByRole('button', { name: /download all video/i }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.mode).toBe('video')
    expect(body.videoQuality).toBe('1080')
  })

  it('disables the Video tab when ffmpeg is missing', () => {
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady={false} />)
    expect(screen.getByRole('button', { name: 'video' })).toBeDisabled()
  })

  const noisy = {
    title: 'Mix',
    count: 1,
    tracks: [{ index: 1, title: 'Song Name (Official Video)', author: 'Chan' }],
  }

  const trackButton = () => screen.getByRole('button', { name: 'Rename track 1' })

  it('previews the cleaned name and can show the original title', () => {
    render(
      <PlaylistPanel
        info={noisy}
        url={PL_URL}
        outputDir={DIR}
        ffmpegReady
        onToggleCleanNames={jest.fn()}
      />
    )
    // The channel is credited, matching what the server will write.
    expect(trackButton()).toHaveTextContent('Song Name - Chan')

    fireEvent.click(screen.getByRole('button', { name: /show original titles/i }))
    expect(trackButton()).toHaveTextContent('Song Name (Official Video)')
  })

  it('renames a track and sends the override with the request', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(<PlaylistPanel info={noisy} url={PL_URL} outputDir={DIR} ffmpegReady />)

    fireEvent.click(trackButton())
    const input = screen.getByLabelText('File name for track 1')
    fireEvent.change(input, { target: { value: 'Hand Written' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(trackButton()).toHaveTextContent('Hand Written')

    fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.names).toEqual({ 1: 'Hand Written' })
  })

  it('discards an edit on Escape and can reset all renames', () => {
    render(<PlaylistPanel info={noisy} url={PL_URL} outputDir={DIR} ffmpegReady />)

    fireEvent.click(trackButton())
    fireEvent.change(screen.getByLabelText('File name for track 1'), { target: { value: 'Nope' } })
    fireEvent.keyDown(screen.getByLabelText('File name for track 1'), { key: 'Escape' })
    expect(trackButton()).toHaveTextContent('Song Name - Chan')

    fireEvent.click(trackButton())
    fireEvent.change(screen.getByLabelText('File name for track 1'), { target: { value: 'Kept' } })
    fireEvent.keyDown(screen.getByLabelText('File name for track 1'), { key: 'Enter' })
    expect(trackButton()).toHaveTextContent('Kept')

    fireEvent.click(screen.getByRole('button', { name: /reset 1 renamed/i }))
    expect(trackButton()).toHaveTextContent('Song Name - Chan')
  })

  it('sends cleanNames:false when the naming toggle is off', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(
      <PlaylistPanel
        info={info}
        url={PL_URL}
        outputDir={DIR}
        ffmpegReady
        cleanNames={false}
        onToggleCleanNames={jest.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.cleanNames).toBe(false)
  })

  it('marks every track pending before a download starts', () => {
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
    expect(screen.getAllByRole('img', { name: /pending/i })).toHaveLength(3)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('offers Cancel while downloading and aborts the request when clicked', async () => {
    const fetchMock = global.fetch as jest.Mock
    const original = fetchMock.getMockImplementation()
    let capturedSignal: AbortSignal | undefined

    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      return Promise.resolve({
        ok: true,
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      } as unknown as Response)
    })

    try {
      render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
      fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))

      const cancelButton = await screen.findByRole('button', { name: /cancel/i })
      fireEvent.click(cancelButton)
      await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    } finally {
      fetchMock.mockImplementation(original!)
    }
  })

  it('caps the track list height so long playlists scroll in place', () => {
    render(<PlaylistPanel info={info} url={PL_URL} outputDir={DIR} ffmpegReady />)
    const list = screen.getByRole('list')
    expect(list).toHaveStyle({ maxHeight: '18rem' })
    expect(list.className).toContain('overflow-y-auto')
  })
})
