import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.removeProperty('--accent')
  document.documentElement.style.removeProperty('--accent-hover')
  document.documentElement.style.removeProperty('--bg-page')
  document.documentElement.style.removeProperty('--bg-card')
  document.documentElement.style.removeProperty('--bg-input')
  document.documentElement.style.removeProperty('--border')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: false, addListener: jest.fn(), removeListener: jest.fn() }),
  })
  jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1 as unknown as ReturnType<typeof requestAnimationFrame>)
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useTheme', () => {
  it('defaults to rainbow mode with red accent', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.accentHex).toBe('#e94560')
    expect(result.current.isRainbow).toBe(true)
  })

  it('applies --accent CSS var on mount', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#e94560')
  })

  it('applies background CSS vars on mount', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.style.getPropertyValue('--bg-page')).not.toBe('')
    expect(document.documentElement.style.getPropertyValue('--bg-card')).not.toBe('')
  })

  it('setPreset updates accentHex and --accent CSS var', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.setPreset('#3b82f6') })
    expect(result.current.accentHex).toBe('#3b82f6')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#3b82f6')
  })

  it('setPreset persists accent and rainbow=false to localStorage', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.setPreset('#10b981') })
    expect(localStorage.getItem('theme-accent')).toBe('#10b981')
    expect(localStorage.getItem('theme-rainbow')).toBe('false')
  })

  it('restores preset accent from localStorage on mount', () => {
    localStorage.setItem('theme-accent', '#8b5cf6')
    const { result } = renderHook(() => useTheme())
    expect(result.current.accentHex).toBe('#8b5cf6')
  })

  it('restores non-rainbow mode from localStorage', () => {
    localStorage.setItem('theme-rainbow', 'false')
    const { result } = renderHook(() => useTheme())
    expect(result.current.isRainbow).toBe(false)
  })

  it('toggleRainbow turns rainbow off', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.toggleRainbow() })
    expect(result.current.isRainbow).toBe(false)
  })

  it('toggleRainbow twice returns to true', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.toggleRainbow() })
    act(() => { result.current.toggleRainbow() })
    expect(result.current.isRainbow).toBe(true)
  })

  it('setPreset disables rainbow mode', () => {
    const { result } = renderHook(() => useTheme())
    // rainbow is on by default
    act(() => { result.current.setPreset('#ec4899') })
    expect(result.current.isRainbow).toBe(false)
    expect(result.current.accentHex).toBe('#ec4899')
  })
})
