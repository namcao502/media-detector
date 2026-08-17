'use client'

import { useRef, useState } from 'react'

interface UrlInputProps {
  onDetect: (url: string) => void
  disabled: boolean
  loading: boolean
}

export default function UrlInput({ onDetect, disabled, loading }: UrlInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = disabled || loading

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (value.trim()) onDetect(value.trim())
  }

  // Clipboard read needs a user gesture and can still be refused; on refusal we
  // just focus the field so the user can paste with the keyboard.
  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        setValue(text.trim())
        onDetect(text.trim())
        return
      }
    } catch {
      // permission denied or unsupported -- fall through to focusing
    }
    inputRef.current?.focus()
  }

  function handleClear() {
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div
        className="field-shell flex min-w-0 flex-1 items-center gap-2 rounded-xl px-4"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
      >
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a YouTube or YouTube Music URL..."
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm disabled:opacity-50"
          style={{ color: 'var(--text-primary)' }}
        />
        {value !== '' && !busy && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear the URL"
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
            style={{ background: 'var(--bg-fill)', color: 'var(--text-secondary)' }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={handlePaste}
        disabled={busy}
        className="flex-shrink-0 rounded-full px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50"
        style={{
          background: 'var(--bg-fill)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        Paste
      </button>
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="flex-shrink-0 rounded-full px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-70 disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? 'Detecting...' : 'Detect'}
      </button>
    </form>
  )
}
