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

describe('StatusBar', () => {
  it('shows green status when all dependencies are OK', () => {
    render(<StatusBar status={allGood} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Python 3.12.2/)).toBeInTheDocument()
    expect(screen.getByText(/2025.04.15/)).toBeInTheDocument()
  })

  it('shows Install Python button when Python is missing', () => {
    render(<StatusBar status={noPython} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Install Python/i)).toBeInTheDocument()
  })

  it('shows Install yt-dlp button when yt-dlp is missing', () => {
    render(<StatusBar status={noYtdlp} onRefresh={jest.fn()} />)
    expect(screen.getByText(/Install/i)).toBeInTheDocument()
  })

  it('calls onRefresh after install completes', async () => {
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
    fireEvent.click(screen.getByText(/Install/i))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
