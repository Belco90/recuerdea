// Hand-rolled MP4/MOV ISO Base Media File Format reader. Both formats share
// the same atom layout, so the same walker works for either. We extract:
//
//   - creation_time from the `mvhd` (movie header) atom
//   - width / height from the first `tkhd` (track header) with non-zero dims
//   - GPS coordinates from `udta.©xyz` (Apple QuickTime; ISO 6709 string)
//
// Best-effort: every field independently degrades to `null`.

const MP4_EPOCH_OFFSET = 2_082_844_800
const RANGE_HEADER_START = 'bytes=0-65535'
const TAIL_SIZE = 1_048_576
const ISO6709_PATTERN = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$/

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
	const mvhd = walkForBox(view, start, end, 'mvhd')
	const captureDate = mvhd ? parseMvhd(view, mvhd.start, mvhd.end) : null
	const dims = findTkhdDimensions(view, start, end)
	const location = findUdtaXyz(view, start, end)
	return { captureDate, width: dims.width, height: dims.height, location }
}

function findUdtaXyz(view: DataView, moovStart: number, moovEnd: number): GeoLocation | null {
	const udta = walkForBox(view, moovStart, moovEnd, 'udta')
	if (!udta) return null
	const xyz = walkForCopyrightBox(view, udta.start, udta.end, 'xyz')
	if (!xyz) return null
	// Body: 2-byte length + 2-byte language code + UTF-8 text. Skip the 4-byte
	// header and decode the rest; the ISO 6709 regex rejects anything malformed.
	if (xyz.end - xyz.start < 4) return null
	const textBytes = new Uint8Array(
		view.buffer,
		view.byteOffset + xyz.start + 4,
		xyz.end - xyz.start - 4,
	)
	const text = new TextDecoder('utf-8', { fatal: false }).decode(textBytes).trim()
	return parseIso6709(text)
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

function parseMvhd(view: DataView, bodyStart: number, bodyEnd: number): Date | null {
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
