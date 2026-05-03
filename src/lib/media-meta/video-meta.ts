// Hand-rolled MP4/MOV ISO Base Media File Format reader. Both formats share
// the same atom layout, so the same walker works for either. We extract:
//
//   - capture date from (in preference order):
//       1. moov.meta keys/ilst `com.apple.quicktime.creationdate` (timezone-aware)
//       2. moov.udta.©day (QuickTime user-data ISO string)
//       3. moov.mvhd.creation_time (rejecting the 0 = 1904-01-01 sentinel)
//       4. any moov.trak.mdia.mdhd.creation_time (same epoch + sentinel)
//     Each candidate runs through `sanityGate` (1990 ≤ date ≤ now+24h).
//   - width / height from the first `tkhd` (track header) with non-zero dims
//   - GPS coordinates from `udta.©xyz` (Apple QuickTime; ISO 6709 string)
//
// Best-effort: every field independently degrades to `null`.

const MP4_EPOCH_OFFSET = 2_082_844_800
const RANGE_HEADER_START = 'bytes=0-65535'
const TAIL_SIZE = 1_048_576
const ISO6709_PATTERN = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/
// Sanity bounds for any atom-derived capture date. Anything older than 1990 or
// more than 24h in the future is almost certainly a sentinel, an encoder bug,
// or a clock-set-to-zero device — better to drop it than to claim it's real.
const MIN_PLAUSIBLE_MS = Date.UTC(1990, 0, 1)
const FUTURE_TOLERANCE_MS = 86_400_000
const MDTA_NAMESPACE = 0x6d_64_74_61 // 'mdta'
const QT_CREATION_DATE_KEY = 'com.apple.quicktime.creationdate'

type BoxLocation = { start: number; end: number }

export type GeoLocation = {
	lat: number
	lng: number
}

export type VideoMeta = {
	captureDate: Date | null
	width: number | null
	height: number | null
	location: GeoLocation | null
}

const EMPTY: VideoMeta = { captureDate: null, width: null, height: null, location: null }

export async function extractVideoMeta(downloadUrl: string): Promise<VideoMeta> {
	const startBuffer = await rangeFetch(downloadUrl, RANGE_HEADER_START)
	if (!startBuffer) return EMPTY

	const fromStart = parseFromBufferStart(startBuffer)
	if (fromStart) return fromStart

	// moov-at-end fallback: cameras often write `mdat` first and finalize `moov`
	// at the end. Range-fetch the tail and linear-scan for the `moov` magic.
	const totalSize = await headContentLength(downloadUrl)
	if (totalSize === null) return EMPTY

	const tailStart = Math.max(startBuffer.byteLength, totalSize - TAIL_SIZE)
	if (tailStart >= totalSize) return EMPTY
	const tailBuffer = await rangeFetch(downloadUrl, `bytes=${tailStart}-${totalSize - 1}`)
	if (!tailBuffer) return EMPTY

	return scanForMoov(new DataView(tailBuffer))
}

async function rangeFetch(url: string, range: string): Promise<ArrayBuffer | null> {
	const res = await fetch(url, { headers: { Range: range } })
	if (!res.ok) return null
	return res.arrayBuffer()
}

async function headContentLength(url: string): Promise<number | null> {
	const res = await fetch(url, { method: 'HEAD' })
	if (!res.ok) return null
	const header = res.headers.get('content-length')
	if (!header) return null
	const n = Number(header)
	return Number.isInteger(n) && n > 0 ? n : null
}

function parseFromBufferStart(buffer: ArrayBuffer): VideoMeta | null {
	const view = new DataView(buffer)
	const moov = walkForBox(view, 0, view.byteLength, 'moov')
	if (!moov) return null
	return parseMoov(view, moov.start, moov.end)
}

function parseMoov(view: DataView, start: number, end: number): VideoMeta {
	const captureDate =
		sanityGate(parseKeysCreationDate(view, start, end)) ??
		sanityGate(parseUdtaCopyrightDay(view, start, end)) ??
		sanityGate(parseMvhdDate(view, start, end)) ??
		sanityGate(parseMdhdFromTraks(view, start, end))
	const dims = findTkhdDimensions(view, start, end)
	const location = findUdtaXyz(view, start, end)
	return { captureDate, width: dims.width, height: dims.height, location }
}

function sanityGate(date: Date | null): Date | null {
	if (!date) return null
	const ms = date.getTime()
	if (ms < MIN_PLAUSIBLE_MS) return null
	if (ms > Date.now() + FUTURE_TOLERANCE_MS) return null
	return date
}

function findUdtaXyz(view: DataView, moovStart: number, moovEnd: number): GeoLocation | null {
	const udta = walkForBox(view, moovStart, moovEnd, 'udta')
	if (!udta) return null
	const xyz = walkForCopyrightBox(view, udta.start, udta.end, 'xyz')
	if (!xyz) return null
	const text = readCopyrightBoxText(view, xyz)
	if (text === null) return null
	return parseIso6709(text)
}

// `©day` body matches `©xyz`: 2-byte length + 2-byte language + UTF-8 text.
// QuickTime ships a date string here that's usually ISO 8601 with timezone
// (`"2017-08-14T18:30:00+0200"`), sometimes date-only (`"2017-08-14"`).
function parseUdtaCopyrightDay(view: DataView, moovStart: number, moovEnd: number): Date | null {
	const udta = walkForBox(view, moovStart, moovEnd, 'udta')
	if (!udta) return null
	const day = walkForCopyrightBox(view, udta.start, udta.end, 'day')
	if (!day) return null
	const text = readCopyrightBoxText(view, day)
	if (text === null) return null
	return parseDateString(text)
}

function readCopyrightBoxText(view: DataView, box: BoxLocation): string | null {
	if (box.end - box.start < 4) return null
	const textBytes = new Uint8Array(
		view.buffer,
		view.byteOffset + box.start + 4,
		box.end - box.start - 4,
	)
	return new TextDecoder('utf-8', { fatal: false }).decode(textBytes).trim()
}

function walkForCopyrightBox(
	view: DataView,
	start: number,
	end: number,
	suffix: string,
): BoxLocation | null {
	if (suffix.length !== 3) return null
	let pos = start
	while (pos + 8 <= end) {
		const sized = readBoxHeader(view, pos, end)
		if (!sized) return null
		if (
			view.getUint8(pos + 4) === 0xa9 &&
			view.getUint8(pos + 5) === suffix.charCodeAt(0) &&
			view.getUint8(pos + 6) === suffix.charCodeAt(1) &&
			view.getUint8(pos + 7) === suffix.charCodeAt(2)
		) {
			return { start: sized.bodyStart, end: sized.boxEnd }
		}
		pos = sized.boxEnd
	}
	return null
}

function parseIso6709(text: string): GeoLocation | null {
	const match = ISO6709_PATTERN.exec(text)
	if (!match) return null
	const lat = Number(match[1])
	const lng = Number(match[2])
	if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null
	if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null
	return { lat, lng }
}

// QuickTime metadata via `moov.meta` keys+ilst. Apple stores the timezone-aware
// capture date under the key `com.apple.quicktime.creationdate`. Layout:
//
//   moov.meta (FullBox: 4-byte version+flags, then children)
//     keys (FullBox: 4-byte v+f, 4-byte entry_count, then [size, namespace, name]*)
//     ilst (container: children typed by uint32 = 1-based key index)
//       <item>
//         data (4-byte type-code | 4-byte locale | UTF-8 text body)
//
// QuickTime files (.mov) sometimes ship `meta` as a plain container (no v+f
// prefix) instead of a FullBox; we try both layouts.
function parseKeysCreationDate(view: DataView, moovStart: number, moovEnd: number): Date | null {
	const meta = walkForBox(view, moovStart, moovEnd, 'meta')
	if (!meta) return null
	return (
		readMetaCreationDate(view, meta.start + 4, meta.end) ??
		readMetaCreationDate(view, meta.start, meta.end)
	)
}

function readMetaCreationDate(view: DataView, start: number, end: number): Date | null {
	if (start > end) return null
	const keys = walkForBox(view, start, end, 'keys')
	const ilst = walkForBox(view, start, end, 'ilst')
	if (!keys || !ilst) return null
	const keyIndex = findKeyIndex(view, keys, QT_CREATION_DATE_KEY)
	if (keyIndex === null) return null
	const item = walkForFourCC(view, ilst.start, ilst.end, keyIndex)
	if (!item) return null
	const data = walkForBox(view, item.start, item.end, 'data')
	if (!data) return null
	return parseDataAtomString(view, data.start, data.end)
}

function findKeyIndex(view: DataView, keys: BoxLocation, targetKey: string): number | null {
	if (keys.end - keys.start < 8) return null
	const entryCount = view.getUint32(keys.start + 4)
	if (entryCount === 0) return null
	let pos = keys.start + 8
	for (let i = 1; i <= entryCount; i++) {
		if (pos + 8 > keys.end) return null
		const size = view.getUint32(pos)
		if (size < 8 || pos + size > keys.end) return null
		// Each entry: [4-byte size][4-byte namespace][key_value bytes]. Apple uses
		// the `mdta` namespace for keys it owns, including QT creationdate.
		if (view.getUint32(pos + 4) === MDTA_NAMESPACE) {
			const keyBytes = new Uint8Array(view.buffer, view.byteOffset + pos + 8, size - 8)
			const name = new TextDecoder('utf-8', { fatal: false }).decode(keyBytes)
			if (name === targetKey) return i
		}
		pos += size
	}
	return null
}

function parseDataAtomString(view: DataView, bodyStart: number, bodyEnd: number): Date | null {
	if (bodyEnd - bodyStart < 8) return null
	// Body header: 1-byte version + 3-byte flags (= type code, low 24 bits) +
	// 4-byte locale. Type code 1 = UTF-8 text; we ignore other encodings.
	const typeCode = view.getUint32(bodyStart) & 0x00_ff_ff_ff
	if (typeCode !== 1) return null
	const textBytes = new Uint8Array(
		view.buffer,
		view.byteOffset + bodyStart + 8,
		bodyEnd - bodyStart - 8,
	)
	const text = new TextDecoder('utf-8', { fatal: false }).decode(textBytes).trim()
	return parseDateString(text)
}

function parseDateString(text: string): Date | null {
	if (!text) return null
	const ms = Date.parse(text)
	if (Number.isNaN(ms)) return null
	return new Date(ms)
}

// Walk all top-level children of `moov` looking for `trak` boxes; pick the
// first `tkhd` with non-zero dimensions (skips audio tracks, which are zero).
function findTkhdDimensions(
	view: DataView,
	moovStart: number,
	moovEnd: number,
): { width: number | null; height: number | null } {
	let pos = moovStart
	while (pos + 8 <= moovEnd) {
		const sized = readBoxHeader(view, pos, moovEnd)
		if (!sized) return { width: null, height: null }
		if (readType(view, pos + 4) === 'trak') {
			const tkhd = walkForBox(view, sized.bodyStart, sized.boxEnd, 'tkhd')
			if (tkhd) {
				const dims = parseTkhdDimensions(view, tkhd.start, tkhd.end)
				if (dims.width !== null && dims.height !== null) return dims
			}
		}
		pos = sized.boxEnd
	}
	return { width: null, height: null }
}

function parseTkhdDimensions(
	view: DataView,
	bodyStart: number,
	bodyEnd: number,
): { width: number | null; height: number | null } {
	if (bodyEnd - bodyStart < 8) return { width: null, height: null }
	// Last 8 bytes of `tkhd` are width and height as 16.16 fixed-point.
	const widthFixed = view.getUint32(bodyEnd - 8)
	const heightFixed = view.getUint32(bodyEnd - 4)
	const width = widthFixed >>> 16
	const height = heightFixed >>> 16
	if (width === 0 || height === 0) return { width: null, height: null }
	return { width, height }
}

function walkForBox(view: DataView, start: number, end: number, type: string): BoxLocation | null {
	let pos = start
	while (pos + 8 <= end) {
		const sized = readBoxHeader(view, pos, end)
		if (!sized) return null
		if (readType(view, pos + 4) === type) {
			return { start: sized.bodyStart, end: sized.boxEnd }
		}
		pos = sized.boxEnd
	}
	return null
}

// Like `walkForBox` but matches the type field as a raw uint32. Needed for
// `ilst` children, whose four-byte type is the 1-based index into `keys`
// rather than an ASCII fourcc.
function walkForFourCC(
	view: DataView,
	start: number,
	end: number,
	fourCC: number,
): BoxLocation | null {
	let pos = start
	while (pos + 8 <= end) {
		const sized = readBoxHeader(view, pos, end)
		if (!sized) return null
		if (view.getUint32(pos + 4) === fourCC) {
			return { start: sized.bodyStart, end: sized.boxEnd }
		}
		pos = sized.boxEnd
	}
	return null
}

function readBoxHeader(
	view: DataView,
	pos: number,
	end: number,
): { bodyStart: number; boxEnd: number } | null {
	let size = view.getUint32(pos)
	let bodyStart = pos + 8
	if (size === 1) {
		if (pos + 16 > end) return null
		const high = view.getUint32(pos + 8)
		const low = view.getUint32(pos + 12)
		if (high !== 0) return null
		size = low
		bodyStart = pos + 16
	} else if (size === 0) {
		size = end - pos
	}
	if (size < 8 || pos + size > end) return null
	return { bodyStart, boxEnd: pos + size }
}

function readType(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3),
	)
}

function parseMvhdDate(view: DataView, moovStart: number, moovEnd: number): Date | null {
	const mvhd = walkForBox(view, moovStart, moovEnd, 'mvhd')
	if (!mvhd) return null
	return readMvhdLikeDate(view, mvhd.start, mvhd.end)
}

// `mdhd` may exist on every `trak`. Some cameras leave `mvhd.creation_time`
// at 0 but populate `mdhd.creation_time` correctly; walk every track and
// take the first non-zero one. The bit layout for the version/flags/
// creation_time prefix is identical to `mvhd`, so we share the parser.
function parseMdhdFromTraks(view: DataView, moovStart: number, moovEnd: number): Date | null {
	let pos = moovStart
	while (pos + 8 <= moovEnd) {
		const sized = readBoxHeader(view, pos, moovEnd)
		if (!sized) return null
		if (readType(view, pos + 4) === 'trak') {
			const mdia = walkForBox(view, sized.bodyStart, sized.boxEnd, 'mdia')
			if (mdia) {
				const mdhd = walkForBox(view, mdia.start, mdia.end, 'mdhd')
				if (mdhd) {
					const date = readMvhdLikeDate(view, mdhd.start, mdhd.end)
					if (date) return date
				}
			}
		}
		pos = sized.boxEnd
	}
	return null
}

function readMvhdLikeDate(view: DataView, bodyStart: number, bodyEnd: number): Date | null {
	if (bodyEnd - bodyStart < 8) return null
	const version = view.getUint8(bodyStart)
	let creationTime: number
	if (version === 0) {
		creationTime = view.getUint32(bodyStart + 4)
	} else if (version === 1) {
		if (bodyEnd - bodyStart < 12) return null
		const high = view.getUint32(bodyStart + 4)
		const low = view.getUint32(bodyStart + 8)
		// Reject creation times that would lose precision in JS's safe-integer range.
		if (high > 0x1f_ff_ff) return null
		creationTime = high * 0x1_00_00_00_00 + low
	} else {
		return null
	}
	// 0 is the well-known "encoder didn't bother" sentinel — would decode to
	// 1904-01-01. The sanity gate at the call site catches it too, but rejecting
	// here keeps the intent explicit and short-circuits the conversion.
	if (creationTime === 0) return null
	const unixSeconds = creationTime - MP4_EPOCH_OFFSET
	const date = new Date(unixSeconds * 1000)
	return Number.isNaN(date.getTime()) ? null : date
}

function scanForMoov(view: DataView): VideoMeta {
	// Linear scan for the literal "moov" four-byte magic. The atom's size prefix
	// sits in the four bytes immediately before the magic.
	const M = 0x6d
	const O = 0x6f
	const V = 0x76
	for (let i = 4; i + 4 <= view.byteLength; i++) {
		if (
			view.getUint8(i) !== M ||
			view.getUint8(i + 1) !== O ||
			view.getUint8(i + 2) !== O ||
			view.getUint8(i + 3) !== V
		) {
			continue
		}
		const moovStart = i - 4
		const size = view.getUint32(moovStart)
		if (size < 8 || moovStart + size > view.byteLength) continue
		const result = parseMoov(view, moovStart + 8, moovStart + size)
		if (result.captureDate || result.width !== null) return result
	}
	return EMPTY
}
