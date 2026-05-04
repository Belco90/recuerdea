import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractVideoMeta } from './video-meta'

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

	describe('width and height', () => {
		it('extracts width/height from a single-track tkhd', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeTrak(makeTkhdV0Body(1920, 1080))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ width: 1920, height: 1080, location: null })
		})

		it('skips audio tracks (zero dimensions) and picks the video track', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
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
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeUdta(makeXyz('+40.4378-003.7036/'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})

		it('returns null dimensions when all tracks have zero dimensions', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeTrak(makeTkhdV0Body(0, 0)), makeUdta(makeXyz('+40.4378-003.7036/'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})

		it('extracts width/height in the moov-at-end tail-fallback path', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const moov = makeMoov(makeTrak(makeTkhdV0Body(1280, 720)))
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
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(
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
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeUdta(makeXyz('+40.4378-003.7036/'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).not.toBeNull()
			expect(meta.location!.lat).toBeCloseTo(40.4378, 4)
			expect(meta.location!.lng).toBeCloseTo(-3.7036, 4)
		})

		it('returns location null when moov has no udta', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeTrak(makeTkhdV0Body(1920, 1080))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when udta has no ©xyz', async () => {
			const otherCopyright = makeAtomCopyright('cmt', new Uint8Array([0, 0, 0, 0]))
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeUdta(otherCopyright)),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when ©xyz payload is malformed', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeUdta(makeXyz('not a coordinate string'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('returns location null when latitude is out of range', async () => {
			const file = concat(
				makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
				makeMoov(makeUdta(makeXyz('+91.0000+000.0000/'))),
			)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta.location).toBeNull()
		})

		it('extracts GPS in the moov-at-end tail-fallback path', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const moov = makeMoov(makeUdta(makeXyz('+40.4378-003.7036/')))
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
		it('returns all-null when no moov is found anywhere', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(64))
			const file = concat(ftyp, mdat)
			fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ width: null, height: null, location: null })
		})

		it('returns all-null on HTTP 4xx response', async () => {
			fetchSpy.mockResolvedValue(new Response(null, { status: 404 }))

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ width: null, height: null, location: null })
		})

		it('returns all-null when HEAD fails during tail fallback', async () => {
			const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
			const mdat = makeAtom('mdat', new Uint8Array(70_000))
			const file = concat(ftyp, mdat)

			fetchSpy.mockImplementation(async (_url, init) => {
				const opts = (init ?? {}) as RequestInit
				if (opts.method === 'HEAD') return new Response(null, { status: 500 })
				return new Response(bytesToBuffer(file.slice(0, 65_536)), { status: 206 })
			})

			const meta = await extractVideoMeta('https://x.test/v.mp4')
			expect(meta).toEqual({ width: null, height: null, location: null })
		})

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
