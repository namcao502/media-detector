import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
        outputDir="C:\\dl"
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
        outputDir="C:\\dl"
        onDownloadStart={onDownloadStart}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(onDownloadStart).toHaveBeenCalledWith('137', 'mp4')
  })

  it('badges the row as Best only when recommended', () => {
    const { rerender } = render(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        outputDir="C:\\dl"
        onDownloadStart={jest.fn()}
      />
    )
    expect(screen.queryByText('Best')).not.toBeInTheDocument()

    rerender(
      <FormatRow
        type="video"
        format={videoFormat}
        url="https://youtube.com/watch?v=x"
        title="Test"
        outputDir="C:\\dl"
        recommended
        onDownloadStart={jest.fn()}
      />
    )
    expect(screen.getByText('Best')).toBeInTheDocument()
  })

  it('offers Cancel while downloading and aborts the request when clicked', async () => {
    const fetchMock = global.fetch as jest.Mock
    const original = fetchMock.getMockImplementation()
    let capturedSignal: AbortSignal | undefined

    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      return Promise.resolve({
        ok: true,
        // A read that never settles keeps the row in its downloading state.
        body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
      } as unknown as Response)
    })

    try {
      render(
        <FormatRow
          type="video"
          format={videoFormat}
          url="https://youtube.com/watch?v=x"
          title="Test"
          outputDir="C:\\dl"
          onDownloadStart={jest.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

      const cancelButton = await screen.findByRole('button', { name: /cancel/i })
      expect(screen.queryByRole('button', { name: /^download$/i })).not.toBeInTheDocument()

      fireEvent.click(cancelButton)
      await waitFor(() => expect(capturedSignal?.aborted).toBe(true))
    } finally {
      fetchMock.mockImplementation(original!)
    }
  })
})
