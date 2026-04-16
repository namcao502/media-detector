# Theme Color Picker Implementation Plan

> **For agentic workers:** Use s3-implement to execute this plan task-by-task.

**Goal:** Add a theme button in the page header that opens a popup with preset color swatches and a rainbow mode toggle that animates the accent color through all hues continuously.

**Architecture:** A `useTheme` hook manages theme state (preset hex or rainbow mode), writes `--accent` and `--accent-hover` CSS custom properties to `document.documentElement`, and drives a `requestAnimationFrame` loop for rainbow mode. A `ThemeButton` component receives the hook output as props and renders the trigger button plus popup. Accent choice persists to `localStorage`.

**Tech Stack:** React hooks, CSS custom properties, requestAnimationFrame, localStorage, Jest/jsdom

---

### Task 1: Update jest.config.ts to cover hooks tests

**Files:**
- Modify: `jest.config.ts`

The `hooks/__tests__/` directory needs jsdom (for `localStorage` and `document`). The current jsdom project only matches `components/**/*.test.tsx`. Extend it to also cover `hooks/**/*.test.ts`.

- [ ] **Step 1: Create the hooks directory and write a placeholder test**

Run: `mkdir -p hooks/__tests__`

Then create `hooks/__tests__/useTheme.test.ts` with a single passing stub:

```ts
// hooks/__tests__/useTheme.test.ts
it('placeholder', () => expect(true).toBe(true))
```

- [ ] **Step 2: Run -- expect no output (test not picked up)**

Run: `npx jest hooks/__tests__/useTheme.test.ts --no-coverage`
Expected: "No tests found" or similar (test not matched by any project)

- [ ] **Step 3: Update jest.config.ts**

Replace the jsdom project block (the one with `displayName: 'jsdom'`):

```ts
{
  displayName: 'jsdom',
  testEnvironment: 'jsdom',
  testMatch: ['**/components/**/*.test.tsx', '**/hooks/**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
},
```

- [ ] **Step 4: Run -- expect PASS**

Run: `npx jest hooks/__tests__/useTheme.test.ts --no-coverage`
Expected: PASS (1 test, placeholder passes)

---

### Task 2: useTheme hook

**Files:**
- Modify: `hooks/__tests__/useTheme.test.ts` (replace placeholder)
- Create: `hooks/useTheme.ts`

- [ ] **Step 1: Write failing tests**

Replace `hooks/__tests__/useTheme.test.ts` with:

```ts
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.style.removeProperty('--accent')
  document.documentElement.style.removeProperty('--accent-hover')
  jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1 as unknown as ReturnType<typeof requestAnimationFrame>)
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useTheme', () => {
  it('defaults to red preset', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.accentHex).toBe('#e94560')
    expect(result.current.isRainbow).toBe(false)
  })

  it('applies --accent CSS var on mount', () => {
    renderHook(() => useTheme())
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#e94560')
  })

  it('setPreset updates accentHex and CSS var', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.setPreset('#3b82f6') })
    expect(result.current.accentHex).toBe('#3b82f6')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#3b82f6')
  })

  it('setPreset persists to localStorage', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.setPreset('#10b981') })
    expect(localStorage.getItem('theme-accent')).toBe('#10b981')
  })

  it('restores preset from localStorage on mount', () => {
    localStorage.setItem('theme-accent', '#8b5cf6')
    const { result } = renderHook(() => useTheme())
    expect(result.current.accentHex).toBe('#8b5cf6')
  })

  it('toggleRainbow sets isRainbow to true', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.toggleRainbow() })
    expect(result.current.isRainbow).toBe(true)
  })

  it('toggleRainbow twice returns to false', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.toggleRainbow() })
    act(() => { result.current.toggleRainbow() })
    expect(result.current.isRainbow).toBe(false)
  })

  it('setPreset while in rainbow mode disables rainbow', () => {
    const { result } = renderHook(() => useTheme())
    act(() => { result.current.toggleRainbow() })
    act(() => { result.current.setPreset('#ec4899') })
    expect(result.current.isRainbow).toBe(false)
    expect(result.current.accentHex).toBe('#ec4899')
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**

Run: `npx jest hooks/__tests__/useTheme.test.ts --no-coverage`
Expected: FAIL "Cannot find module '../useTheme'"

- [ ] **Step 3: Create hooks/useTheme.ts**

```ts
// hooks/useTheme.ts
import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_ACCENT = '#e94560'
const STORAGE_KEY = 'theme-accent'

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360
  const sNorm = s / 100
  const lNorm = l / 100
  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm
  const p = 2 * lNorm - q
  const hue2rgb = (input: number): number => {
    const t = input < 0 ? input + 1 : input > 1 ? input - 1 : input
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const toHex = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${toHex(hue2rgb(hNorm + 1 / 3))}${toHex(hue2rgb(hNorm))}${toHex(hue2rgb(hNorm - 1 / 3))}`
}

function applyAccent(hex: string): void {
  const [h, s, l] = hexToHsl(hex)
  document.documentElement.style.setProperty('--accent', hex)
  document.documentElement.style.setProperty('--accent-hover', hslToHex(h, s, Math.max(0, l - 10)))
}

export interface ThemeControls {
  accentHex: string
  isRainbow: boolean
  setPreset: (hex: string) => void
  toggleRainbow: () => void
}

export function useTheme(): ThemeControls {
  const [accentHex, setAccentHex] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_ACCENT
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ACCENT
  })
  const [isRainbow, setIsRainbow] = useState(false)
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const hueRef = useRef(0)

  useEffect(() => {
    if (!isRainbow) {
      applyAccent(accentHex)
    }
  }, [accentHex, isRainbow])

  useEffect(() => {
    if (!isRainbow) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const animate = () => {
      hueRef.current = (hueRef.current + 0.5) % 360
      const hex = hslToHex(hueRef.current, 80, 55)
      document.documentElement.style.setProperty('--accent', hex)
      document.documentElement.style.setProperty('--accent-hover', hslToHex(hueRef.current, 80, 45))
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isRainbow])

  const setPreset = useCallback((hex: string) => {
    setIsRainbow(false)
    setAccentHex(hex)
    localStorage.setItem(STORAGE_KEY, hex)
  }, [])

  const toggleRainbow = useCallback(() => {
    setIsRainbow((prev) => !prev)
  }, [])

  return { accentHex, isRainbow, setPreset, toggleRainbow }
}
```

- [ ] **Step 4: Run -- expect PASS**

Run: `npx jest hooks/__tests__/useTheme.test.ts --no-coverage`
Expected: PASS (8 tests)

---

### Task 3: ThemeButton component

**Files:**
- Create: `components/ThemeButton.tsx`
- Create: `components/__tests__/ThemeButton.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// components/__tests__/ThemeButton.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ThemeButton from '../ThemeButton'

const mockSetPreset = jest.fn()
const mockToggleRainbow = jest.fn()

const defaultProps = {
  accentHex: '#e94560',
  isRainbow: false,
  setPreset: mockSetPreset,
  toggleRainbow: mockToggleRainbow,
}

beforeEach(() => {
  mockSetPreset.mockClear()
  mockToggleRainbow.mockClear()
})

describe('ThemeButton', () => {
  it('renders the theme toggle button', () => {
    render(<ThemeButton {...defaultProps} />)
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })

  it('popup is not visible initially', () => {
    render(<ThemeButton {...defaultProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens popup when theme button is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes popup when clicking outside', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    fireEvent.mousedown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls setPreset when a color swatch is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    const swatches = screen.getAllByRole('button', { name: /color/i })
    expect(swatches.length).toBeGreaterThan(0)
    fireEvent.click(swatches[0])
    expect(mockSetPreset).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/i))
  })

  it('calls toggleRainbow when rainbow strip is clicked', () => {
    render(<ThemeButton {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    fireEvent.click(screen.getByRole('button', { name: /rainbow/i }))
    expect(mockToggleRainbow).toHaveBeenCalled()
  })

  it('shows active outline on rainbow button when isRainbow is true', () => {
    render(<ThemeButton {...defaultProps} isRainbow />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    const rainbowBtn = screen.getByRole('button', { name: /rainbow/i })
    expect(rainbowBtn.style.outline).not.toBe('none')
  })

  it('marks active swatch with data-active attribute', () => {
    render(<ThemeButton {...defaultProps} accentHex="#3b82f6" />)
    fireEvent.click(screen.getByRole('button', { name: /theme/i }))
    expect(screen.getByRole('button', { name: /color blue/i })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('button', { name: /color red/i })).not.toHaveAttribute('data-active', 'true')
  })
})
```

- [ ] **Step 2: Run -- expect FAIL**

Run: `npx jest components/__tests__/ThemeButton.test.tsx --no-coverage`
Expected: FAIL "Cannot find module '../ThemeButton'"

- [ ] **Step 3: Create components/ThemeButton.tsx**

```tsx
// components/ThemeButton.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { ThemeControls } from '@/hooks/useTheme'

const PRESETS: { label: string; hex: string }[] = [
  { label: 'Red', hex: '#e94560' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Green', hex: '#10b981' },
  { label: 'Purple', hex: '#8b5cf6' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Cyan', hex: '#06b6d4' },
]

export default function ThemeButton({ accentHex, isRainbow, setPreset, toggleRainbow }: ThemeControls) {
  const [open, setOpen] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        aria-label="Theme"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          cursor: 'pointer',
          padding: '4px 10px',
          color: 'var(--text-secondary)',
          fontSize: '16px',
          lineHeight: 1,
        }}
      >
        &#127912;
      </button>

      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Theme picker"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '14px',
            width: '224px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Accent Color
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {PRESETS.map(({ label, hex }) => {
              const isActive = accentHex === hex && !isRainbow
              return (
                <button
                  key={hex}
                  aria-label={`Color ${label}`}
                  data-active={isActive ? 'true' : undefined}
                  onClick={() => { setPreset(hex); setOpen(false) }}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: hex,
                    border: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
                    boxShadow: isActive ? '0 0 0 2px var(--bg-card) inset' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              )
            })}
          </div>

          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Rainbow Mode
          </div>

          <button
            aria-label="Rainbow mode"
            onClick={toggleRainbow}
            style={{
              width: '100%',
              height: '28px',
              borderRadius: '8px',
              background:
                'linear-gradient(to right, #e94560, #f97316, #eab308, #10b981, #3b82f6, #8b5cf6, #ec4899, #e94560)',
              border: 'none',
              cursor: 'pointer',
              outline: isRainbow ? '2px solid var(--text-primary)' : 'none',
              outlineOffset: '2px',
            }}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run -- expect PASS**

Run: `npx jest components/__tests__/ThemeButton.test.tsx --no-coverage`
Expected: PASS (8 tests)

---

### Task 4: Wire ThemeButton into page.tsx

**Files:**
- Modify: `app/page.tsx`

The current header has hardcoded Tailwind color classes (`text-gray-100`, `text-gray-500`) that bypass the theme system. Replace with CSS vars and add `ThemeButton`.

- [ ] **Step 1: Add a smoke test to ThemeButton.test.tsx**

Append to `components/__tests__/ThemeButton.test.tsx`:

```tsx
describe('ThemeButton integration', () => {
  it('renders theme button with correct aria-label for screen readers', () => {
    render(<ThemeButton {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /theme/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })
})
```

Run: `npx jest components/__tests__/ThemeButton.test.tsx --no-coverage`
Expected: PASS (9 tests)

- [ ] **Step 2: Modify app/page.tsx**

Add imports at the top of `app/page.tsx`:

```tsx
import ThemeButton from '@/components/ThemeButton'
import { useTheme } from '@/hooks/useTheme'
```

Inside the `Home` function, add after the existing `useState` calls:

```tsx
const theme = useTheme()
```

Replace the existing header block:

```tsx
<div className="text-center">
  <h1 className="text-2xl font-bold uppercase tracking-widest text-gray-100">
    Media Detector
  </h1>
  <p className="mt-1 text-xs text-gray-500">YouTube & YouTube Music</p>
</div>
```

With:

```tsx
<div style={{ position: 'relative', textAlign: 'center' }}>
  <div style={{ position: 'absolute', right: 0, top: 0 }}>
    <ThemeButton
      accentHex={theme.accentHex}
      isRainbow={theme.isRainbow}
      setPreset={theme.setPreset}
      toggleRainbow={theme.toggleRainbow}
    />
  </div>
  <h1
    className="text-2xl font-bold uppercase tracking-widest"
    style={{ color: 'var(--text-primary)' }}
  >
    Media Detector
  </h1>
  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
    YouTube & YouTube Music
  </p>
</div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors

---

### Task 5: Verify full test suite

- [ ] **Step 1: Run all tests**

Run: `npm test -- --no-coverage`
Expected: all tests PASS (no regressions in StatusBar, UrlInput, FormatRow, DownloadProgress)
