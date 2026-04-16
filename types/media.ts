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
}

export interface DownloadRequest {
  url: string
  formatId: string
  title: string
  ext: string
}

export interface DownloadProgressLine {
  type: 'progress'
  percent: number
}

export interface DownloadDoneLine {
  type: 'done'
  savedPath: string
}

export interface DownloadErrorLine {
  type: 'error'
  message: string
}

export type DownloadStreamLine = DownloadProgressLine | DownloadDoneLine | DownloadErrorLine
