import { render, screen, fireEvent } from '@testing-library/react'
import FormatRow from '../FormatRow'
import type { VideoFormat } from '@/types/media'

const videoFormat: VideoFormat = {
  formatId: '137',
  ext: 'mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  vcodec: 'avc1',
  filesize: 2400000000,
}

describe('FormatRow (video)', () => {
  it('displays resolution, codec, and file size', () => {
    render(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        onDownloadStart={jest.fn()}
      />
    )
    expect(screen.getByText(/1080p/)).toBeInTheDocument()
    expect(screen.getByText(/avc1/i)).toBeInTheDocument()
  })

  it('calls onDownloadStart when Download is clicked', () => {
    const onDownloadStart = jest.fn()
    render(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        onDownloadStart={onDownloadStart}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(onDownloadStart).toHaveBeenCalledWith('137', 'mp4')
  })
})
