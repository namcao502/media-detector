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

describe('PlaylistPanel', () => {
  it('renders playlist title, track count, and track titles', () => {
    render(<PlaylistPanel info={info} url="https://youtube.com/playlist?list=PL1" />)
    expect(screen.getByText('My Mix')).toBeInTheDocument()
    expect(screen.getByText(/3 tracks/)).toBeInTheDocument()
    expect(screen.getByText(/Song A/)).toBeInTheDocument()
    expect(screen.getByText(/Song C/)).toBeInTheDocument()
  })

  it('posts to /api/playlist/download when Download all audio is clicked', () => {
    const fetchMock = global.fetch as jest.Mock
    fetchMock.mockClear()
    render(<PlaylistPanel info={info} url="https://youtube.com/playlist?list=PL1" />)
    fireEvent.click(screen.getByRole('button', { name: /download all audio/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlist/download',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ url: 'https://youtube.com/playlist?list=PL1' }),
      }),
    )
  })
})
