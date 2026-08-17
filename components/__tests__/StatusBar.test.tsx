import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StatusBar from '../StatusBar'
import type { StatusResult } from '@/types/media'

const allGood: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'up-to-date' },
  ffmpeg: { found: true, version: '7.1' },
}

const noPython: StatusResult = {
  python: { found: false, version: null },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
  ffmpeg: { found: false, version: null },
}

const noYtdlp: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
  ffmpeg: { found: true, version: '7.1' },
}

const ytdlpUpdateFailed: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'failed' },
  ffmpeg: { found: true, version: '7.1' },
}

const noFfmpeg: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'up-to-date' },
  ffmpeg: { found: false, version: null },
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /show dependency details/i }))
}

describe('StatusBar', () => {
  it('collapses to a Ready summary with every version when all deps are OK', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText(/Python 3\.12\.2 \. yt-dlp 2025\.04\.15 \. ffmpeg 7\.1/)).toBeInTheDocument()
    // Detail rows stay hidden until asked for.
    expect(screen.queryByText(/Version 3\.12\.2 detected/)).not.toBeInTheDocument()
  })

  it('reveals a row per dependency once expanded', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expand()
    expect(screen.getByText('Python')).toBeInTheDocument()
    expect(screen.getByText(/Version 3\.12\.2 detected/)).toBeInTheDocument()
    expect(screen.getByText('yt-dlp')).toBeInTheDocument()
    expect(screen.getByText(/Version 2025\.04\.15 -- up to date/)).toBeInTheDocument()
    expect(screen.getByText('ffmpeg')).toBeInTheDocument()
    expect(screen.getByText(/metadata & thumbnails embedded/i)).toBeInTheDocument()
  })

  it('shows a single loading row when status is null', () => {
    render(<StatusBar status={null} onRefresh={jest.fn()} />)
    expect(screen.getByText(/checking dependencies/i)).toBeInTheDocument()
  })

  it('calls onRefresh when Recheck is clicked', () => {
    const onRefresh = jest.fn()
    render(<StatusBar status={allGood} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /recheck/i }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('stays expanded and hides the collapse toggle when a dep has a problem', () => {
    render(<StatusBar status={noFfmpeg} onRefresh={jest.fn()} />)
    expect(screen.getByText('1 problem')).toBeInTheDocument()
    expect(screen.getByText(/install ffmpeg to embed metadata/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /show dependency details/i })).not.toBeInTheDocument()
  })

  it('counts multiple problems in the headline', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText('3 problems')).toBeInTheDocument()
  })

  it('shows Install button and manual link when ffmpeg is missing', () => {
    render(<StatusBar status={noFfmpeg} onRefresh={jest.fn()} />)
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /manual/i })).toBeInTheDocument()
  })

  it('shows python.org link when Python is missing', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText(/install Python 3\.8/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /python\.org/i })).toBeInTheDocument()
  })

  it('shows Install button when yt-dlp is missing and Python is present', () => {
    render(<StatusBar status={noYtdlp} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Not installed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
  })

  it('shows Retry button when yt-dlp update failed', () => {
    render(<StatusBar status={ytdlpUpdateFailed} onRefresh={jest.fn()} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onRefresh after install stream completes', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: jest.fn().mockResolvedValueOnce({ done: true, value: undefined }),
        }),
      },
    } as unknown as Response)

    const onRefresh = jest.fn()
    render(<StatusBar status={noYtdlp} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: /^install$/i }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
