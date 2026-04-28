import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractVideoCaptureDate } from './video-meta'

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
	// v0 mvhd is 100 bytes: version+flags(4) + creation(4) + modification(4) + timescale(4)
	// + duration(4) + rate(4) + volume(2) + reserved(10) + matrix(36) + pre_defined(24) + next_track_id(4)
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

function makeMoov(mvhdBody: Uint8Array): Uint8Array {
	return makeAtom('moov', makeAtom('mvhd', mvhdBody))
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

describe('extractVideoCaptureDate', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
	})

	afterEach(() => {
		fetchSpy.mockRestore()
	})

	it('parses moov-at-start with v0 mvhd', async () => {
		const expected = new Date('2019-04-27T14:30:00Z')
		const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
		const moov = makeMoov(makeMvhdV0Body(dateToMp4Seconds(expected)))
		const mdat = makeAtom('mdat', new Uint8Array(64))
		const file = concat(ftyp, moov, mdat)
		fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toEqual(expected)
	})

	it('parses moov-at-start with v1 mvhd (64-bit)', async () => {
		const expected = new Date('2024-01-15T09:00:00Z')
		const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
		const moov = makeMoov(makeMvhdV1Body(dateToMp4Seconds(expected)))
		const file = concat(ftyp, moov)
		fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toEqual(expected)
	})

	it('falls back to tail fetch when moov sits after a large mdat', async () => {
		const expected = new Date('2019-04-27T14:30:00Z')
		const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
		const mdat = makeAtom('mdat', new Uint8Array(70_000)) // > 64KB → forces tail fallback
		const moov = makeMoov(makeMvhdV0Body(dateToMp4Seconds(expected)))
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

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toEqual(expected)
	})

	it('returns null when no moov is found anywhere', async () => {
		const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
		const mdat = makeAtom('mdat', new Uint8Array(64))
		const file = concat(ftyp, mdat)
		fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toBeNull()
	})

	it('returns null when moov has no mvhd inside it', async () => {
		const ftyp = makeAtom('ftyp', new Uint8Array([0, 0, 0, 0]))
		const moovWithoutMvhd = makeAtom('moov', makeAtom('trak', new Uint8Array(20)))
		const file = concat(ftyp, moovWithoutMvhd)
		fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toBeNull()
	})

	it('returns null on HTTP 4xx response', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 404 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toBeNull()
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

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toBeNull()
	})

	it('returns null for an unrecognized mvhd version', async () => {
		const badMvhdBody = new Uint8Array(100)
		const view = new DataView(badMvhdBody.buffer)
		view.setUint32(0, 0x05_00_00_00) // version=5 (unknown)
		const file = concat(
			makeAtom('ftyp', new Uint8Array([0, 0, 0, 0])),
			makeAtom('moov', makeAtom('mvhd', badMvhdBody)),
		)
		fetchSpy.mockResolvedValue(new Response(bytesToBuffer(file), { status: 200 }))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).resolves.toBeNull()
	})

	it('sends a Range header for the first fetch', async () => {
		fetchSpy.mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }))

		await extractVideoCaptureDate('https://x.test/v.mp4')

		expect(fetchSpy).toHaveBeenCalledWith('https://x.test/v.mp4', {
			headers: { Range: 'bytes=0-65535' },
		})
	})

	it('propagates network errors from fetch', async () => {
		fetchSpy.mockRejectedValue(new Error('network down'))

		await expect(extractVideoCaptureDate('https://x.test/v.mp4')).rejects.toThrow('network down')
	})
})
