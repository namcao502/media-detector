import { renderHook, act, waitFor } from '@testing-library/react'
import { useOutputDir } from '../useOutputDir'

const fetchMock = global.fetch as jest.Mock

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockClear()
})

describe('useOutputDir', () => {
  it('restores a stored dir without fetching the default', () => {
    localStorage.setItem('output-dir', 'C:\\Music')
    const { result } = renderHook(() => useOutputDir())
    expect(result.current.dir).toBe('C:\\Music')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the server default when nothing is stored', async () => {
    fetchMock.mockResolvedValueOnce({ json: () => Promise.resolve({ dir: 'C:\\Default' }) })
    const { result } = renderHook(() => useOutputDir())
    await waitFor(() => expect(result.current.dir).toBe('C:\\Default'))
  })

  it('setDir persists to localStorage', () => {
    localStorage.setItem('output-dir', 'C:\\Music')
    const { result } = renderHook(() => useOutputDir())
    act(() => result.current.setDir('D:\\Podcasts'))
    expect(result.current.dir).toBe('D:\\Podcasts')
    expect(localStorage.getItem('output-dir')).toBe('D:\\Podcasts')
  })

  it('reset clears storage and reverts to the server default', async () => {
    localStorage.setItem('output-dir', 'C:\\Music')
    const { result } = renderHook(() => useOutputDir())
    fetchMock.mockResolvedValueOnce({ json: () => Promise.resolve({ dir: 'C:\\Default' }) })
    act(() => result.current.reset())
    expect(localStorage.getItem('output-dir')).toBeNull()
    await waitFor(() => expect(result.current.dir).toBe('C:\\Default'))
  })
})
