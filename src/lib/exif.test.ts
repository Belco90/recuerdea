import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractCaptureDate } from './exif'

const { mockedParse } = vi.hoisted(() => ({
	mockedParse: vi.fn<typeof import('exifr').parse>(),
}))

vi.mock('exifr', () => ({
	default: { parse: mockedParse },
}))

describe('extractCaptureDate', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
	})

	afterEach(() => {
		fetchSpy.mockRestore()
		vi.clearAllMocks()
	})

	function mockOkResponse(): void {
		fetchSpy.mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }))
	}

	it('returns DateTimeOriginal when present', async () => {
		mockOkResponse()
		const expected = new Date('2019-04-27T14:30:00Z')
		mockedParse.mockResolvedValue({ DateTimeOriginal: expected })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toEqual(expected)
	})

	it('falls back to CreateDate when DateTimeOriginal is absent', async () => {
		mockOkResponse()
		const expected = new Date('2021-07-08T12:00:00Z')
		mockedParse.mockResolvedValue({ CreateDate: expected })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toEqual(expected)
	})

	it('falls back to DateTime when DateTimeOriginal and CreateDate are absent', async () => {
		mockOkResponse()
		const expected = new Date('2020-01-15T09:00:00Z')
		mockedParse.mockResolvedValue({ DateTime: expected })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toEqual(expected)
	})

	it('prefers DateTimeOriginal over CreateDate over DateTime', async () => {
		mockOkResponse()
		const original = new Date('2019-04-27T14:30:00Z')
		const created = new Date('2022-06-01T00:00:00Z')
		const modified = new Date('2024-01-01T00:00:00Z')
		mockedParse.mockResolvedValue({
			DateTimeOriginal: original,
			CreateDate: created,
			DateTime: modified,
		})

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toEqual(original)
	})

	it('prefers CreateDate over DateTime when DateTimeOriginal is absent', async () => {
		mockOkResponse()
		const created = new Date('2022-06-01T00:00:00Z')
		const modified = new Date('2024-01-01T00:00:00Z')
		mockedParse.mockResolvedValue({ CreateDate: created, DateTime: modified })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toEqual(created)
	})

	it('sends a Range header for the EXIF segment', async () => {
		mockOkResponse()
		mockedParse.mockResolvedValue({ DateTimeOriginal: new Date() })

		await extractCaptureDate('https://x.test/a.jpg')

		expect(fetchSpy).toHaveBeenCalledWith('https://x.test/a.jpg', {
			headers: { Range: 'bytes=0-65535' },
		})
	})

	it('returns null when exifr returns undefined (no EXIF block)', async () => {
		mockOkResponse()
		mockedParse.mockResolvedValue(undefined)

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
	})

	it('returns null when exifr returns no date tags', async () => {
		mockOkResponse()
		mockedParse.mockResolvedValue({})

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
	})

	it('returns null when exifr throws (corrupt header)', async () => {
		mockOkResponse()
		mockedParse.mockRejectedValue(new Error('bad jpeg'))

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
	})

	it('returns null when the date tag is not a Date instance', async () => {
		mockOkResponse()
		mockedParse.mockResolvedValue({ DateTimeOriginal: '2019-04-27' })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
	})

	it('returns null when the date tag is an invalid Date', async () => {
		mockOkResponse()
		mockedParse.mockResolvedValue({ DateTimeOriginal: new Date('not-a-date') })

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
	})

	it('returns null when the response is not ok (4xx/5xx)', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 404 }))

		await expect(extractCaptureDate('https://x.test/a.jpg')).resolves.toBeNull()
		expect(mockedParse).not.toHaveBeenCalled()
	})

	it('propagates network errors from fetch', async () => {
		fetchSpy.mockRejectedValue(new Error('network down'))

		await expect(extractCaptureDate('https://x.test/a.jpg')).rejects.toThrow('network down')
	})
})
