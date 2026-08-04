import { render, screen, fireEvent } from '@testing-library/react'
import PlaylistPanel from '../PlaylistPanel'
import type { PlaylistInfo } from '@/types/media'

const info: PlaylistInfo = {
  title: 'My Mix',
  count: 3,
  tracks: [
    { index: 1, title: 'Song A' },
    { index: 2, title: 'Song B' },
    { index: 3, title: 'Song C' },
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
        body: JSON.stringify({ url: PL_URL, outputDir: DIR, mode: 'audio', audioFormat: 'm4a', videoQuality: '1080' }),
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
})
