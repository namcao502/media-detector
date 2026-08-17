import { render, screen, act } from '@testing-library/react'
import DownloadProgress from '../DownloadProgress'

describe('DownloadProgress', () => {
  it('shows progress bar with percentage', () => {
    render(<DownloadProgress percent={65} savedPath={null} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText(/65%/)).toBeInTheDocument()
  })

  it('shows Open Folder button when savedPath is set', () => {
    render(<DownloadProgress percent={100} savedPath="C:\\Users\\test\\Documents\\MediaDetector\\test.mp4" />)
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument()
    expect(screen.getByText(/Saved to/i)).toBeInTheDocument()
  })

  it('shows transferred bytes, speed and ETA', () => {
    render(
      <DownloadProgress
        percent={50}
        savedPath={null}
        active
        detail={{
          type: 'progress',
          percent: 50,
          downloadedBytes: 24_000_000,
          totalBytes: 48_000_000,
          speedBytesPerSec: 1_200_000,
          etaSeconds: 20,
        }}
      />
    )
    expect(screen.getByText(/24.0 MB \/ 48.0 MB/)).toBeInTheDocument()
    expect(screen.getByText(/1.2 MB\/s/)).toBeInTheDocument()
    expect(screen.getByText(/ETA 0:20/)).toBeInTheDocument()
  })

  it('shows the fragment counter for fragmented downloads', () => {
    render(
      <DownloadProgress
        percent={10}
        savedPath={null}
        active
        detail={{ type: 'progress', percent: 10, fragmentIndex: 3, fragmentCount: 48 }}
      />
    )
    expect(screen.getByText(/frag 3\/48/)).toBeInTheDocument()
  })

  it('shows the current phase label', () => {
    render(<DownloadProgress percent={100} savedPath={null} active phaseLabel="Merging video and audio" />)
    expect(screen.getByText('Merging video and audio')).toBeInTheDocument()
  })

  it('warns once the stream has been silent past the stall threshold', () => {
    jest.useFakeTimers()
    try {
      const startedAt = Date.now()
      render(<DownloadProgress percent={40} savedPath={null} active lastUpdateAt={startedAt} phaseLabel="Downloading" />)
      expect(screen.queryByText(/no update for/i)).not.toBeInTheDocument()

      act(() => { jest.advanceTimersByTime(6000) })
      expect(screen.getByText(/no update for 6s/i)).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows an error message when the download fails', () => {
    render(<DownloadProgress percent={30} savedPath={null} error="Video unavailable" />)
    expect(screen.getByText('Video unavailable')).toBeInTheDocument()
  })
})
