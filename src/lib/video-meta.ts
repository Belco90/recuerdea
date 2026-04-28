// Hand-rolled MP4/MOV `mvhd` reader. Both formats use ISO Base Media File Format,
// so the same atom walk works for either. We only extract `creation_time`; the
// rest of the atom layout is ignored.

const MP4_EPOCH_OFFSET = 2_082_844_800
const RANGE_HEADER_START = 'bytes=0-65535'
const TAIL_SIZE = 1_048_576

type BoxLocation = { start: number; end: number }

export async function extractVideoCaptureDate(downloadUrl: string): Promise<Date | null> {
	const startBuffer = await rangeFetch(downloadUrl, RANGE_HEADER_START)
	if (!startBuffer) return null

	const fromStart = parseFromBufferStart(startBuffer)
	if (fromStart) return fromStart

	// moov-at-end fallback: cameras often write `mdat` first and finalize `moov`
	// at the end. Range-fetch the tail and linear-scan for the `moov` magic.
	const totalSize = await headContentLength(downloadUrl)
	if (totalSize === null) return null

	const tailStart = Math.max(startBuffer.byteLength, totalSize - TAIL_SIZE)
	if (tailStart >= totalSize) return null
	const tailBuffer = await rangeFetch(downloadUrl, `bytes=${tailStart}-${totalSize - 1}`)
	if (!tailBuffer) return null

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

function parseFromBufferStart(buffer: ArrayBuffer): Date | null {
	const view = new DataView(buffer)
	const moov = walkForBox(view, 0, view.byteLength, 'moov')
	if (!moov) return null
	const mvhd = walkForBox(view, moov.start, moov.end, 'mvhd')
	if (!mvhd) return null
	return parseMvhd(view, mvhd.start, mvhd.end)
}

function walkForBox(view: DataView, start: number, end: number, type: string): BoxLocation | null {
	let pos = start
	while (pos + 8 <= end) {
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
		if (readType(view, pos + 4) === type) {
			return { start: bodyStart, end: pos + size }
		}
		pos += size
	}
	return null
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

function scanForMoov(view: DataView): Date | null {
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
		const moov: BoxLocation = { start: moovStart + 8, end: moovStart + size }
		const mvhd = walkForBox(view, moov.start, moov.end, 'mvhd')
		if (!mvhd) continue
		const date = parseMvhd(view, mvhd.start, mvhd.end)
		if (date) return date
	}
	return null
}
