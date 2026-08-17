// Download file naming: "<title> - <artist>.<ext>".
//
// The name is computed HERE and handed to yt-dlp as a literal `-o` path rather
// than as a template. Two reasons:
//
//  1. yt-dlp decides a file is "already downloaded" by comparing against the
//     name its `-o` produces. A literal name is stable across runs, so
//     re-running a playlist still skips what it already has -- which is how a
//     playlist is resumed. (Renaming after the download would break that.)
//  2. The UI preview and the real filename come from one function, so they
//     cannot drift. An earlier version expressed these rules as
//     --replace-in-metadata/--parse-metadata args with a JS mirror for the
//     preview; keeping two engines in step was the bulk of the complexity.
//
// Everything below is pure and unit-tested.

export interface NameSource {
  title: string
  // From yt-dlp metadata; any may be absent.
  track?: string | null
  artist?: string | null
  uploader?: string | null
  channel?: string | null
}

// Straight and curly double quotes, used interchangeably in show titles.
const QUOTE = '"“”'
const QUOTED_SPAN = new RegExp(`^([^${QUOTE}]*)[${QUOTE}]([^${QUOTE}]+)[${QUOTE}](.*)$`)

// Vietnamese variety-show genre words. Deliberately the diacritic forms: they
// anchor the show-title rules so those cannot fire on other content.
const GENRE = '(?:hài\\s+kịch|tấu\\s+hài|hài|kịch)'

// Pipe-delimited segments that name the channel or series rather than a person.
// Only ever matched as a WHOLE segment -- "Thúy Nga" is also a performer in this
// catalogue, and inside a comma list she must survive.
const BRAND_SEGMENTS = [
  'thúy nga', 'thuy nga', 'paris by night', 'pbn tiếu vương hội', 'pbn',
]

// Auto-generated YouTube Music channels are named "<Artist> - Topic".
export function stripTopicSuffix(name: string): string {
  return name.replace(/\s*-\s*topic\s*$/i, '')
}

function dropBrandSegments(title: string): string {
  if (!title.includes('|')) return title
  const kept = title
    .split('|')
    .filter((segment) => !BRAND_SEGMENTS.includes(segment.trim().toLowerCase()))
  return kept.join('|')
}

function tidy(value: string): string {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—|,:]+|[\s\-–—|,:]+$/g, '')
    .trim()
}

function stripShowFurniture(segment: string): string {
  return tidy(
    segment
      .replace(/\bPBN\s*\d*/gi, '')
      .replace(new RegExp(`^\\s*${GENRE}\\b`, 'gi'), '')
      .replace(new RegExp(`[\\-–—]\\s*${GENRE}\\b`, 'gi'), ' ')
      .replace(/[\-–—]/g, ' '),
  )
}

// Turns the leftovers around a show's title into the performer list. The
// remainder is split on '|' first: a series label sits in its own segment
// ("... | Phi Nhung, Bảo Chung | Về Quê Em 1"), so flattening the pipes would
// glue it onto the last performer's name.
function castFromRemainder(remainder: string): string {
  const candidates = remainder
    .split('|')
    .map(stripShowFurniture)
    .filter((segment) => segment !== '' && looksLikeCast(segment))

  if (candidates.length === 0) return ''

  // The real cast is the comma-rich segment; a series label has none.
  const countCommas = (value: string) => (value.match(/,/g) ?? []).length
  const best = [...candidates].sort(
    (a, b) => countCommas(b) - countCommas(a) || b.length - a.length,
  )
  return best[0]
}

export interface ShowParts {
  track: string
  cast: string | null
}

// A performer list is a few short names. Promo copy ("Vở hài kịch lấy nhiều
// nước mắt khán giả của Xuân Bắc, Tự Long") also contains commas, and treating
// it as the credit is how a title ends up inverted, so every
// comma/ampersand-separated part has to be name-shaped.
const MAX_WORDS_PER_NAME = 4
const MAX_CAST_LENGTH = 120

export function looksLikeCast(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_CAST_LENGTH) return false

  const parts = trimmed.split(/[,&]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return false
  if (parts.some((part) => part.split(/\s+/).length > MAX_WORDS_PER_NAME)) return false

  // A lone one-word fragment is a leftover adjective ("Hot"), not a person.
  return parts.length > 1 || parts[0].split(/\s+/).length > 1
}

// Recognises the three shapes this catalogue uses, in order of confidence.
// Returns null for anything that is not show-shaped, which is most content.
export function parseShowTitle(rawTitle: string): ShowParts | null {
  const title = dropBrandSegments(rawTitle)

  // 1. The real name is quoted; everything else around it is series/genre/cast.
  const quoted = QUOTED_SPAN.exec(title)
  if (quoted) {
    const cast = castFromRemainder(`${quoted[1]} | ${quoted[3]}`)
    return { track: tidy(quoted[2]), cast: looksLikeCast(cast) ? cast : null }
  }

  // 2. Genre word, then the cast, then a separator, then the name:
  //    "Hài Hoài Linh, Chí Tài - Con Sáo Sang Sông".
  const leadingCast = new RegExp(
    `^\\s*${GENRE}\\s+([^|\\-–—]*,[^|\\-–—]*?)\\s*[|\\-–—]\\s*(.+)$`, 'i',
  )
  const lead = leadingCast.exec(title)
  if (lead) {
    const cast = castFromRemainder(lead[1])
    const track = tidy(lead[2].replace(/\s*[|\-–—]?\s*\bPBN\s*\d*/gi, ''))
    if (track && looksLikeCast(cast)) return { track, cast }
  }

  // 3. Name first, then a trailing cast list of at least two names:
  //    "Hài Kịch Chuyện Ba Người - Hoài Linh, Long Đẹp Trai, Tú Tri".
  const trailingCast = new RegExp(
    `^\\s*(${GENRE}\\s+.+?)\\s*[|\\-–—]\\s*([^|\\-–—]+,[^|\\-–—]+)$`, 'i',
  )
  const trail = trailingCast.exec(title)
  if (trail) {
    const cast = castFromRemainder(trail[2])
    const withoutEpisode = trail[1].replace(/\s*[|\-–—]?\s*\bPBN\s*\d*/gi, '')
    // Only drop a bare genre prefix from the plain "Genre Name - Cast" form.
    // In a pipe-structured title the genre word is part of a longer phrase
    // ("Hài Kịch Mới || ..."), and cutting it leaves a meaningless "Mới".
    const track = tidy(
      withoutEpisode.includes('|')
        ? withoutEpisode
        : withoutEpisode.replace(new RegExp(`^\\s*${GENRE}\\s+(?=\\S)`, 'i'), ''),
    )
    if (track && looksLikeCast(cast)) return { track, cast }
  }

  return null
}

// Promotional noise carried by ordinary (non-show) titles.
interface CleanRule {
  pattern: RegExp
  replacement: string
}

const NOISE_RULES: readonly CleanRule[] = [
  {
    pattern: /\s*[([][^)\]]*(?:official|lyric|audio|video|visuali[sz]er|remaster(?:ed)?|explicit|hd|hq|4k|8k|m\/?v)[^)\]]*[)\]]/gi,
    replacement: '',
  },
  // The leading \s+ matters: without it the "ft" inside "Daft Punk" matches and
  // eats the rest of the title.
  { pattern: /\s+[([]?\s*(?:ft|feat)\.?\s+[^)\]]*[)\]]?\s*$/gi, replacement: '' },
  { pattern: /\s*[|\-–—]\s*(?:official|lyrics?|audio|visuali[sz]er|m\/?v)\b.*$/gi, replacement: '' },
  { pattern: /\s+(?:m\/?v|official\s+(?:music\s+)?video|lyrics?\s+video|visuali[sz]er)\s*$/gi, replacement: '' },
  // Each alternative needs a digit, unit or acronym so years survive
  // ("Blade Runner 2049" is untouched).
  { pattern: /\s+(?:\d{3,4}p(?:\d{2,3})?|[248]k|uhd|fhd|hdr|\d{2,3}\s*fps|full\s+hd|hd|hq)\b/gi, replacement: '' },
]

export function cleanTitle(title: string): string {
  const cleaned = NOISE_RULES.reduce(
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    title,
  )
  return tidy(cleaned)
}

// yt-dlp does not strip filesystem-illegal characters, it swaps in full-width
// lookalikes. Mirrored exactly (verified against yt_dlp.utils.sanitize_filename)
// so our literal names look like the ones yt-dlp would have written.
const CHAR_SUBSTITUTIONS: Readonly<Record<string, string>> = {
  '/': '⧸',  // big solidus
  '\\': '⧹', // big reverse solidus
  ':': '：',  // fullwidth colon
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜',
  '*': '＊',
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control chars have no lookalike
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[/\\:?"<>|*]/g, (char) => CHAR_SUBSTITUTIONS[char])
    .trim()
  return cleaned || 'Untitled'
}

function stripAuthorPrefix(title: string, author: string): string {
  if (!author) return title
  const escaped = author.replace(/[.*+?^${}()|[\]\\/\-]/g, '\\$&')
  return title.replace(new RegExp(`^\\s*${escaped}\\s*[-–—]\\s*`, 'i'), '')
}

// The credit that goes after the title: the show's performers when the title
// names them, else the music artist, else the channel.
export function effectiveAuthor(source: NameSource): string {
  const show = parseShowTitle(source.title)
  if (show?.cast) return show.cast

  const fallback = source.artist || source.uploader || source.channel || ''
  return stripTopicSuffix(fallback).trim() || 'Unknown'
}

// The filename without its extension. Single source of truth: the UI previews
// this and the routes hand it to yt-dlp verbatim.
export function downloadStem(source: NameSource): string {
  const show = parseShowTitle(source.title)
  const author = effectiveAuthor(source)

  const base = show
    ? show.track
    : cleanTitle(stripAuthorPrefix(source.track || source.title, author))

  const stem = author && author !== base ? `${base} - ${author}` : base
  return sanitizeFilename(stem)
}

// The stem yt-dlp would use untouched, shown next to the cleaned one so the
// user can see exactly what changed.
export function rawStem(source: NameSource): string {
  return sanitizeFilename(source.title)
}

// A stem typed by the user. Untrusted: it arrives in a request body and is
// pasted into an absolute output path. sanitizeFilename maps both separators to
// full-width lookalikes, so no input can climb out of the download folder.
// Returns null when nothing usable is left, letting the caller fall back to the
// computed name.
export function sanitizeUserStem(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed === '') return null

  const safe = sanitizeFilename(trimmed)
  // Reject names made only of dots -- '.' and '..' are directory entries.
  if (/^\.+$/.test(safe)) return null
  return safe
}

export function buildDownloadName(source: NameSource, ext: string): string {
  return `${downloadStem(source)}.${ext}`
}

export function buildRawName(source: NameSource, ext: string): string {
  return `${rawStem(source)}.${ext}`
}

// Turns an already-joined absolute path into a literal `-o` value. Only
// %(ext)s stays a template -- the extension is not known until yt-dlp has
// picked (and possibly converted) the format. Any '%' in the path must be
// doubled or yt-dlp reads it as a field placeholder.
export function outputTemplateFor(literalPathWithoutExt: string): string {
  return `${literalPathWithoutExt.replace(/%/g, '%%')}.%(ext)s`
}
