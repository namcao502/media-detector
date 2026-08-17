export interface VideoFormat {
  formatId: string
  ext: string
  width: number
  height: number
  fps: number | null
  vcodec: string
  filesize: number | null
}

export interface AudioFormat {
  formatId: string
  ext: string
  abr: number | null
  acodec: string
  filesize: number | null
}

export interface MediaInfo {
  title: string
  channel: string
  duration: number
  thumbnail: string
  viewCount: number | null
  videoFormats: VideoFormat[]
  audioFormats: AudioFormat[]
}

export type UpdateStatus = 'updated' | 'up-to-date' | 'failed' | 'skipped'

export interface StatusResult {
  python: { found: boolean; version: string | null }
  ytdlp: { found: boolean; version: string | null; updateStatus: UpdateStatus }
  // Optional -- downloads work without it; required only to embed metadata + thumbnails.
  ffmpeg: { found: boolean; version: string | null }
}

export interface DownloadRequest {
  url: string
  formatId: string
  title: string
  ext: string
}

// Byte/speed/ETA fields are optional: yt-dlp reports them as "NA" until the
// transfer has enough samples, and a live stream has no known total size.
export interface DownloadProgressLine {
  type: 'progress'
  percent: number
  downloadedBytes?: number
  totalBytes?: number
  speedBytesPerSec?: number
  etaSeconds?: number
  fragmentIndex?: number
  fragmentCount?: number
}

// Coarse stage of a single yt-dlp run. Only 'downloading' reports a percentage;
// the ffmpeg-backed stages (merge/convert/embed) report no progress at all, so
// the UI needs the label to explain why the bar has stopped moving.
export type DownloadPhase =
  | 'extracting'
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'embedding'
  | 'finishing'

export interface DownloadPhaseLine {
  type: 'phase'
  phase: DownloadPhase
  label: string
}

export interface DownloadDoneLine {
  type: 'done'
  savedPath: string
}

export interface DownloadErrorLine {
  type: 'error'
  message: string
}

export type DownloadStreamLine =
  | DownloadProgressLine
  | DownloadPhaseLine
  | DownloadDoneLine
  | DownloadErrorLine

export type PlaylistFormatMode = 'audio' | 'video'
export type PlaylistAudioFormat = 'm4a' | 'mp3' | 'best' // 'best' = native, no conversion
export type PlaylistVideoQuality = '1080' | '720' | 'best'

export interface PlaylistFormatSelection {
  mode: PlaylistFormatMode
  audioFormat?: PlaylistAudioFormat
  videoQuality?: PlaylistVideoQuality
}

export interface PlaylistTrack {
  index: number // 1-based position in the playlist
  title: string
}

export interface PlaylistInfo {
  title: string
  count: number
  tracks: PlaylistTrack[]
}

export interface PlaylistItemLine {
  type: 'item'
  index: number
  total: number
}

export interface PlaylistTrackDoneLine {
  type: 'track-done'
  index: number
  savedPath: string
}

export interface PlaylistTrackRetryLine {
  type: 'track-retry'
  index: number
  attempt: number
  phase: 1 | 2
}

export interface PlaylistTrackSkippedLine {
  type: 'track-skipped' // failed phase 1; will be re-swept in phase 2
  index: number
}

export interface PlaylistTrackErrorLine {
  type: 'track-error' // failed both phases
  index: number
  title: string
}

export interface PlaylistBatchDoneLine {
  type: 'done'
  folder: string
  downloaded: number
  total: number
  failed: number
}

// Reuses DownloadProgressLine ({type:'progress',...}) and DownloadPhaseLine for
// the current track, and DownloadErrorLine ({type:'error',message}) for a fatal
// spawn error.
export type PlaylistDownloadLine =
  | DownloadProgressLine
  | DownloadPhaseLine
  | PlaylistItemLine
  | PlaylistTrackDoneLine
  | PlaylistTrackRetryLine
  | PlaylistTrackSkippedLine
  | PlaylistTrackErrorLine
  | PlaylistBatchDoneLine
  | DownloadErrorLine
