import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractVideoMeta } from './video-meta'

const MP4_EPOCH_OFFSET = 2_082_844_800

function dateToMp4Seconds(date: Date): number {
	return Math.floor(date.getTime() / 1000) + MP4_EPOCH_OFFSET
}

function writeAscii(view: DataView, offset: number, text: string): void {
	for (let i = 0; i < text.length; i++) {
		view.setUint8(offset + i, text.charCodeAt(i))
	}
}

function makeAtom(type: string, body: Uint8Array): Uint8Array {
	if (type.length !== 4) throw new Error('atom type must be 4 chars')
	const total = 8 + body.length
	const out = new Uint8Array(total)
	const view = new DataView(out.buffer)
	view.setUint32(0, total)
	writeAscii(view, 4, type)
	out.set(body, 8)
	return out
}

function makeMvhdV0Body(creationTime: number): Uint8Array {
	// v0 mvhd is 100 bytes
	const body = new Uint8Array(100)
	const view = new DataView(body.buffer)
	view.setUint32(0, 0) // version=0, flags=0
	view.setUint32(4, creationTime >>> 0)
	return body
}

function makeMvhdV1Body(creationTime: number): Uint8Array {
	// v1 mvhd is 112 bytes (creation/modification/duration are 64-bit)
	const body = new Uint8Array(112)
	const view = new DataView(body.buffer)
	view.setUint32(0, 0x01_00_00_00) // version=1, flags=0
	const high = Math.floor(creationTime / 0x100000000)
	const low = creationTime >>> 0
	view.setUint32(4, high)
	view.setUint32(8, low)
	return body
}

function makeTkhdV0Body(width: number, height: number): Uint8Array {
	// v0 tkhd is 84 bytes; width/height live in the trailing 8 bytes as
	// 16.16 fixed-point.
	const body = new Uint8Array(84)
	const view = new DataView(body.buffer)
	view.setUint32(76, width << 16)
	view.setUint32(80, height << 16)
	return body
}

function makeTrak(tkhdBody: Uint8Array): Uint8Array {
	return makeAtom('trak', makeAtom('tkhd', tkhdBody))
}

function makeMoov(...children: Uint8Array[]): Uint8Array {
	return makeAtom('moov', concat(...children))
}

function makeUdta(...children: Uint8Array[]): Uint8Array {
	return makeAtom('udta', concat(...children))
}

// `©xyz` body is: 2-byte length (uint16 BE) + 2-byte language code + UTF-8 text.
function makeXyzBody(text: string): Uint8Array {
	const utf8 = new TextEncoder().encode(text)
	const out = new Uint8Array(4 + utf8.length)
	const view = new DataView(out.buffer)
	view.setUint16(0, utf8.length)
	view.setUint16(2, 0)
	out.set(utf8, 4)
	return out
}

// Atom whose four-byte type starts with 0xA9 (Apple's "©" reserved-name marker).
function makeAtomCopyright(suffix: string, body: Uint8Array): Uint8Array {
	if (suffix.length !== 3) throw new Error('suffix must be 3 chars')
	const total = 8 + body.length
	const out = new Uint8Array(total)
	const view = new DataView(out.buffer)
	view.setUint32(0, total)
	view.setUint8(4, 0xa9)
	view.setUint8(5, suffix.charCodeAt(0))
	view.setUint8(6, suffix.charCodeAt(1))
	view.setUint8(7, suffix.charCodeAt(2))
	out.set(body, 8)
	return out
}

function makeXyz(text: string): Uint8Array {
	return makeAtomCopyright('xyz', makeXyzBody(text))
}

// `©day` body is identical to `©xyz`: 2-byte length + 2-byte language + UTF-8.
function makeDay(text: string): Uint8Array {
	return makeAtomCopyright('day', makeXyzBody(text))
}

// v0 mdhd is 24 bytes: 4-byte version+flags, 4-byte creation_time,
// 4-byte modification_time, 4-byte timescale, 4-byte duration,
// 2-byte language, 2-byte pre_defined.
function makeMdhdV0Body(creationTime: number): Uint8Array {
	const body = new Uint8Array(24)
	const view = new DataView(body.buffer)
	view.setUint32(0, 0)
	view.setUint32(4, creationTime >>> 0)
	return body
}

function makeMdia(mdhdBody: Uint8Array): Uint8Array {
	return makeAtom('mdia', makeAtom('mdhd', mdhdBody))
}

function makeTrakWithMdhd(mdhdBody: Uint8Array): Uint8Array {
	return makeAtom('trak', makeMdia(mdhdBody))
}

// Apple QuickTime metadata blob: moov.meta wrapping keys + ilst.
//
//   meta (FullBox: 4-byte version+flags prefix)
//     keys: 4-byte v+f, 4-byte entry_count, then [size, namespace='mdta', name]*
//     ilst: children typed by uint32 = 1-based key index. Each contains a
//           `data` atom: 4-byte type-code (1 = UTF-8) + 4-byte locale + bytes.
function makeQuicktimeKeysMeta(entries: { key: string; value: string }[]): Uint8Array {
	const encoder = new TextEncoder()

	const keyEntries = entries.map(({ key }) => {
		const nameBytes = encoder.encode(key)
		const entry = new Uint8Array(8 + nameBytes.length)
		const view = new DataView(entry.buffer)
		view.setUint32(0, entry.length)
		view.setUint32(4, 0x6d_64_74_61) // 'mdta'
		entry.set(nameBytes, 8)
		return entry
	})
	const keysHeader = new Uint8Array(8)
	new DataView(keysHeader.buffer).setUint32(4, entries.length)
	const keysBody = concat(keysHeader, ...keyEntries)
	const keysAtom = makeAtom('keys', keysBody)

	const ilstChildren = entries.map((e, i) => {
		const valueBytes = encoder.encode(e.value)
		const dataBody = new Uint8Array(8 + valueBytes.length)
		const dview = new DataView(dataBody.buffer)
		dview.setUint32(0, 1) // version=0, flags=type-code=1 (UTF-8)
		dview.setUint32(4, 0) // locale
		dataBody.set(valueBytes, 8)
		const dataAtom = makeAtom('data', dataBody)
		// Container atom whose four-byte type is the 1-based key index.
		const out = new Uint8Array(8 + dataAtom.length)
		const ov = new DataView(out.buffer)
		ov.setUint32(0, out.length)
		ov.setUint32(4, i + 1)
		out.set(dataAtom, 8)
		return out
	})
	const ilstAtom = makeAtom('ilst', concat(...ilstChildren))

	const versionFlags = new Uint8Array(4)
	const metaBody = concat(versionFlags, keysAtom, ilstAtom)
	return makeAtom('meta', metaBody)
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(p, offset)
		offset += p.length
	}
	return out
}

function bytesToBuffer(bytes: Uint8Array): ArrayBuffer {
	const ab = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(ab).set(bytes)
	return ab
}

describe('extractVideoMeta', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
	})

	afterEach(() => {
		fetchSpy.mockRestore()
	})

	describe('captureDate', () => {
		it('parses moov-at-start with v0 mvhd', async () => {
			const expected = new Date('2019-04-27T14:30:00Z')
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const moov = makeMoov(makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(expected))))
			const mdat = makeAtom('mdat', new Uint8Array(64))
			const file = concat(ftyp, moov, mdat)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(expected)
		})

		it('parses moov-at-start with v1 mvhd (64-bit)', async () => {
			const expected = new Date('2024-01-15T09:00:00Z')
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const moov = makeMoov(makeAtom('mvhd', makeMvhdV1Body(dateToMp4Seconds(expected))))
			const file = concat(ftyp, moov)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(expected)
		})

		it('falls back to tail fetch when moov sits after a large mdat', async () => {
			const expected = new Date('2019-04-27T14:30:00Z')
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const moov = makeMoov(makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(expected))))
			const file = concat(ftyp, mdat, moov)

			fetchSpy.mockImplementation(async (_url, init) => {
				const opts = (init ?? {}) as RequestInit
				if (opts.method === 'HEAD') {
					return new Response(null, {
						status: 200,
						headers: { 'content-length': String(file.byteLength) },
					})
				}
				const range = (opts.headers as Record<string, string> | undefined)?.Range
				if (!range) return new Response(bytesToBuffer(file), { status: 200 })
				const match = range.match(/bytes=(\d+)-(\d+)/)
				if (!match) return new Response(null, { status: 416 })
				const start = Number(match[1])
				const end = Number(match[2])
				const slice = file.slice(start, Math.min(end + 1, file.byteLength))
				return new Response(bytesToBuffer(slice), { status: 206 })
			})

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(expected)
		})

		it('returns null captureDate when no moov is found anywhere', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(64))
			const file = concat(ftyp, mdat)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ captureDate: null, width: null, height: null, location: null })
		})

		it('returns null captureDate when moov has no mvhd inside it', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const moovWithoutMvhd = makeMoov(makeAtom('trak', new Uint8Array(20)))
			const file = concat(ftyp, moovWithoutMvhd)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})

		it('returns null on HTTP 4xx response', async () => {
			fetchSpy.mockResolvedValue(new Response(null, { status: 404 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ captureDate: null, width: null, height: null, location: null })
		})

		it('returns null when HEAD fails during tail fallback', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const file = concat(ftyp, mdat)

			fetchSpy.mockImplementation(async (_url, init) => {
				const opts = (init ?? {}) as RequestInit
				if (opts.method === 'HEAD') return new Response(null, { status: 500 })
				return new Response(bytesToBuffer(file.slice(0, 65_536)), { status: 206 })
			})

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ captureDate: null, width: null, height: null, location: null })
		})

		it('returns null for an unrecognized mvhd version', async () => {
			const badMvhdBody = new Uint8Array(100)
			const view = new DataView(badMvhdBody.buffer)
			view.setUint32(0, 0x05_00_00_00) // version=5 (unknown)
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', badMvhdBody)),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('captureDate sentinels and sanity gate', () => {
		it('rejects mvhd creation_time = 0 (1904-01-01 sentinel)', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(0))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})

		it('rejects an mvhd date earlier than 1990-01-01', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(new Date('1985-06-01T00:00:00Z')))),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})

		it('rejects an mvhd date more than 24h in the future', async () => {
			const future = new Date(Date.now() + 1000 * 60 * 60 * 48)
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(future)))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('captureDate from udta.©day', () => {
		it('parses an ISO+timezone string', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(0)),
					makeUdta(makeDay('2017-08-14T18:30:00+0200')),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(new Date('2017-08-14T18:30:00+0200'))
		})

		it('parses a date-only string as UTC midnight', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(0)), makeUdta(makeDay('2017-08-14'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(new Date('2017-08-14T00:00:00Z'))
		})

		it('returns null when ©day payload is unparseable', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(0)), makeUdta(makeDay('not a date string'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('captureDate from moov.meta keys/ilst', () => {
		it('parses com.apple.quicktime.creationdate from keys+ilst', async () => {
			const expected = new Date('2023-04-15T14:32:00+0200')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(0)),
					makeQuicktimeKeysMeta([
						{ key: 'com.apple.quicktime.make', value: 'Apple' },
						{ key: 'com.apple.quicktime.creationdate', value: '2023-04-15T14:32:00+0200' },
					]),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(expected)
		})

		it('returns null when keys has no com.apple.quicktime.creationdate entry', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(0)),
					makeQuicktimeKeysMeta([{ key: 'com.apple.quicktime.make', value: 'Apple' }]),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('captureDate from mdhd', () => {
		it('reads mdhd.creation_time from a trak when mvhd is 0', async () => {
			const expected = new Date('2022-09-10T08:15:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(0)),
					makeTrakWithMdhd(makeMdhdV0Body(dateToMp4Seconds(expected))),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(expected)
		})

		it('rejects mdhd creation_time = 0', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(0)), makeTrakWithMdhd(makeMdhdV0Body(0))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('captureDate source preference', () => {
		it('prefers keys creationdate over udta.©day, mvhd, and mdhd', async () => {
			const keysDate = new Date('2023-04-15T14:32:00+0200')
			const udtaDate = new Date('2020-01-01T00:00:00Z')
			const mvhdDate = new Date('2019-04-27T14:30:00Z')
			const mdhdDate = new Date('2018-04-27T14:30:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeQuicktimeKeysMeta([
						{ key: 'com.apple.quicktime.creationdate', value: '2023-04-15T14:32:00+0200' },
					]),
					makeUdta(makeDay(udtaDate.toISOString())),
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(mvhdDate))),
					makeTrakWithMdhd(makeMdhdV0Body(dateToMp4Seconds(mdhdDate))),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(keysDate)
		})

		it('prefers udta.©day over mvhd and mdhd when keys is missing', async () => {
			const udtaDate = new Date('2020-01-01T00:00:00Z')
			const mvhdDate = new Date('2019-04-27T14:30:00Z')
			const mdhdDate = new Date('2018-04-27T14:30:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeUdta(makeDay(udtaDate.toISOString())),
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(mvhdDate))),
					makeTrakWithMdhd(makeMdhdV0Body(dateToMp4Seconds(mdhdDate))),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(udtaDate)
		})

		it('prefers mvhd over mdhd when both are valid', async () => {
			const mvhdDate = new Date('2019-04-27T14:30:00Z')
			const mdhdDate = new Date('2018-04-27T14:30:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(mvhdDate))),
					makeTrakWithMdhd(makeMdhdV0Body(dateToMp4Seconds(mdhdDate))),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(mvhdDate)
		})
	})

	describe('width and height', () => {
		it('extracts width/height from a single-track tkhd', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeTrak(makeTkhdV0Body(1920, 1080)),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ captureDate: date, width: 1920, height: 1080, location: null })
		})

		it('skips audio tracks (zero dimensions) and picks the video track', async () => {
			const date = new Date('2021-04-27T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeTrak(makeTkhdV0Body(0, 0)), // audio: zero dims
					makeTrak(makeTkhdV0Body(3840, 2160)), // video
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.width).toBe(3840)
			expect(meta.height).toBe(2160)
		})

		it('returns null dimensions when moov has no trak', async () => {
			const date = new Date('2019-04-27T14:30:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date)))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.captureDate).toEqual(date)
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})

		it('returns null dimensions when all tracks have zero dimensions', async () => {
			const date = new Date('2019-04-27T14:30:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeTrak(makeTkhdV0Body(0, 0)),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})

		it('extracts width/height in the moov-at-end tail-fallback path', async () => {
			const date = new Date('2019-04-27T14:30:00Z')
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const moov = makeMoov(
				makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
				makeTrak(makeTkhdV0Body(1280, 720)),
			)
			const file = concat(ftyp, mdat, moov)

			fetchSpy.mockImplementation(async (_url, init) => {
				const opts = (init ?? {}) as RequestInit
				if (opts.method === 'HEAD') {
					return new Response(null, {
						status: 200,
						headers: { 'content-length': String(file.byteLength) },
					})
				}
				const range = (opts.headers as Record<string, string> | undefined)?.Range
				if (!range) return new Response(bytesToBuffer(file), { status: 200 })
				const match = range.match(/bytes=(\d+)-(\d+)/)
				if (!match) return new Response(null, { status: 416 })
				const start = Number(match[1])
				const end = Number(match[2])
				const slice = file.slice(start, Math.min(end + 1, file.byteLength))
				return new Response(bytesToBuffer(slice), { status: 206 })
			})

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.width).toBe(1280)
			expect(meta.height).toBe(720)
		})
	})

	describe('location', () => {
		it('extracts GPS from moov.udta.©xyz with altitude (iPhone format)', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeTrak(makeTkhdV0Body(1920, 1080)),
					makeUdta(makeXyz('+40.4378-003.7036+660.000/')),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).not.toBeNull()
			expect(meta.location!.lat).toBeCloseTo(40.4378, 4)
			expect(meta.location!.lng).toBeCloseTo(-3.7036, 4)
		})

		it('extracts GPS without altitude', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeUdta(makeXyz('+40.4378-003.7036/')),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).not.toBeNull()
			expect(meta.location!.lat).toBeCloseTo(40.4378, 4)
			expect(meta.location!.lng).toBeCloseTo(-3.7036, 4)
		})

		it('returns location null when moov has no udta', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeTrak(makeTkhdV0Body(1920, 1080)),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when udta has no ©xyz', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const otherCopyright = makeAtomCopyright('cmt', new Uint8Array([0, 0, 0, 0]))
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeUdta(otherCopyright),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when ©xyz payload is malformed', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeUdta(makeXyz('not a coordinate string')),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when latitude is out of range', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
					makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
					makeUdta(makeXyz('+91.0000+000.0000/')),
				),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('extracts GPS in the moov-at-end tail-fallback path', async () => {
			const date = new Date('2020-06-01T10:00:00Z')
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const moov = makeMoov(
				makeAtom('mvhd', makeMvhdV0Body(dateToMp4Seconds(date))),
				makeUdta(makeXyz('+40.4378-003.7036/')),
			)
			const file = concat(ftyp, mdat, moov)

			fetchSpy.mockImplementation(async (_url, init) => {
				const opts = (init ?? {}) as RequestInit
				if (opts.method === 'HEAD') {
					return new Response(null, {
						status: 200,
						headers: { 'content-length': String(file.byteLength) },
					})
				}
				const range = (opts.headers as Record<string, string> | undefined)?.Range
				if (!range) return new Response(bytesToBuffer(file), { status: 200 })
				const match = range.match(/bytes=(\d+)-(\d+)/)
				if (!match) return new Response(null, { status: 416 })
				const start = Number(match[1])
				const end = Number(match[2])
				const slice = file.slice(start, Math.min(end + 1, file.byteLength))
				return new Response(bytesToBuffer(slice), { status: 206 })
			})

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).not.toBeNull()
			expect(meta.location!.lat).toBeCloseTo(40.4378, 4)
		})
	})

	describe('error handling', () => {
		it('sends a Range header for the first fetch', async () => {
			fetchSpy.mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }))

			await extractVideoMeta('https://x.test/v.mp4')

			expect(fetchSpy).toHaveBeenCalledWith('https://x.test/v.mp4', {
				headers: { Range: 'bytes=0-65535' },
			})
		})

		it('propagates network errors from fetch', async () => {
			fetchSpy.mockRejectedValue(new Error('network down'))

			await expect(extractVideoMeta('https://x.test/v.mp4')).rejects.toThrow('network down')
		})
	})
})
