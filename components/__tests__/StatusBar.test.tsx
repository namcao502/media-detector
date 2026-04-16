import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import StatusBar from '../StatusBar'
import type { StatusResult } from '@/types/media'

const allGood: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'up-to-date' },
}

const noPython: StatusResult = {
  python: { found: false, version: null },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
}

const noYtdlp: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: false, version: null, updateStatus: 'skipped' },
}

const ytdlpUpdateFailed: StatusResult = {
  python: { found: true, version: '3.12.2' },
  ytdlp: { found: true, version: '2025.04.15', updateStatus: 'failed' },
}

describe('StatusBar', () => {
  it('shows a row per dependency with version when all OK', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expect(screen.getByText('Python')).toBeInTheDocument()
    expect(screen.getByText(/Version 3.12.2 detected/)).toBeInTheDocument()
    expect(screen.getByText('yt-dlp')).toBeInTheDocument()
    expect(screen.getByText(/2025.04.15/)).toBeInTheDocument()
  })

  it('shows loading rows when status is null', () => {
    render(<StatusBar status={null} onRefresh={jest.fn()} />)
    expect(screen.getAllByText('Checking...')).toHaveLength(2)
  })

  it('shows python.org link when Python is missing', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /install/i }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
