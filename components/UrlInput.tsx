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
        className="flex-1 rounded-lg bg-[#0f3460] px-4 py-3 text-gray-200 placeholder-gray-500 outline-none focus:ring-2 focus:ring-[#e94560] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || loading || !value.trim()}
        className="rounded-lg bg-[#e94560] px-6 py-3 font-semibold text-white hover:bg-[#d63651] disabled:opacity-50"
      >
        {loading ? 'Detecting...' : 'Detect'}
      </button>
    </form>
  )
}
