import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme'

function mockPrefersDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: dark, addListener: jest.fn(), removeListener: jest.fn() }),
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  mockPrefersDark(false)
})

describe('useTheme', () => {
  it('defaults to the OS preference (light) when nothing is stored', () => {
    mockPrefersDark(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.mode).toBe('light')
  })

  it('defaults to dark when the OS prefers dark', () => {
    mockPrefersDark(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.mode).toBe('dark')
  })

  it('restores a stored mode over the OS preference', () => {
    mockPrefersDark(true)
    localStorage.setItem('theme-mode', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.mode).toBe('light')
  })

  it('sets data-theme on the document element on mount', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('toggle flips the mode, persists it, and updates data-theme', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.mode).toBe('light')
    act(() => { result.current.toggle() })
    expect(result.current.mode).toBe('dark')
    expect(localStorage.getItem('theme-mode')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
