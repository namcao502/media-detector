// Human-readable formatters for download progress. Pure -- shared by the
// single-download and playlist UIs. Everything unknown renders as '--' so a
// missing field never shows as "undefined" or "NaN".

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const PLACEHOLDER = '--'

function isUsableNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0
}

// Decimal units (KB = 1000 B) to match the sizes YouTube and file managers show.
export function formatBytes(bytes: number | undefined): string {
  if (!isUsableNumber(bytes)) return PLACEHOLDER
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit !== 0 && value < 100 ? 1 : 0
  return `${value.toFixed(digits)} ${SIZE_UNITS[unit]}`
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!isUsableNumber(bytesPerSec) || bytesPerSec === 0) return PLACEHOLDER
  return `${formatBytes(bytesPerSec)}/s`
}

// Containing folder of a saved file, keeping the separator style of the input
// (Windows backslash or POSIX slash) so the path can be handed straight back to
// the OS file manager. Returns '' when there is no separator to split on.
export function parentDir(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  if (index < 0) return ''
  if (index === 0) return filePath.slice(0, 1)
  return filePath.slice(0, index)
}

// m:ss, or h:mm:ss past an hour.
export function formatDuration(seconds: number | undefined): string {
  if (!isUsableNumber(seconds)) return PLACEHOLDER
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours !== 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
