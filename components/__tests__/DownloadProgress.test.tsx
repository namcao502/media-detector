import { render, screen } from '@testing-library/react'
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
})
