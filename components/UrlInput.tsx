'use client'

import { useState } from 'react'

interface UrlInputProps {
  onDetect: (url: string) => void
  disabled: boolean
  loading: boolean
}

export default function UrlInput({ onDetect, disabled, loading }: UrlInputProps) {
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (value.trim()) onDetect(value.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste a YouTube or YouTube Music URL..."
        disabled={disabled || loading}
        className="flex-1 rounded-lg px-4 py-3 text-sm outline-none disabled:opacity-50"
        style={{
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      />
      <button
        type="submit"
        disabled={disabled || loading || !value.trim()}
        className="rounded-lg px-6 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {loading ? 'Detecting...' : 'Detect'}
      </button>
    </form>
  )
}
