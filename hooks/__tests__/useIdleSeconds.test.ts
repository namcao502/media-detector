import { renderHook, act } from '@testing-library/react'
import { useIdleSeconds } from '../useIdleSeconds'

describe('useIdleSeconds', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('counts seconds since the last update while active', () => {
    const startedAt = Date.now()
    const { result } = renderHook(() => useIdleSeconds(startedAt, true))
    expect(result.current).toBe(0)

    act(() => { jest.advanceTimersByTime(3000) })
    expect(result.current).toBe(3)
  })

  it('resets when a newer update arrives', () => {
    const { result, rerender } = renderHook(
      ({ at }: { at: number }) => useIdleSeconds(at, true),
      { initialProps: { at: Date.now() } },
    )
    act(() => { jest.advanceTimersByTime(4000) })
    expect(result.current).toBe(4)

    rerender({ at: Date.now() })
    expect(result.current).toBe(0)
  })

  it('stays at zero and runs no timer when inactive', () => {
    const startedAt = Date.now()
    const { result } = renderHook(() => useIdleSeconds(startedAt, false))
    act(() => { jest.advanceTimersByTime(10000) })
    expect(result.current).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })
})
