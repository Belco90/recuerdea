import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractImageMeta } from './exif'

const { mockedParse } = vi.hoisted(() => ({
	mockedParse: vi.fn<typeof import('exifr').parse>(),
}))

vi.mock('exifr', () => ({
	default: { parse: mockedParse },
}))

describe('extractImageMeta', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
	})

	afterEach(() => {
		fetchSpy.mockRestore()
	})

	function mockOkResponse(): void {
		fetchSpy.mockResolvedValue(new Response(new ArrayBuffer(8), { status: 200 }))
	}

	describe('captureDate', () => {
		it('returns DateTimeOriginal when present', async () => {
			mockOkResponse()
			const expected = new Date('2019-04-27T14:30:00Z')
			mockedParse.mockResolvedValue({ DateTimeOriginal: expected })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toEqual(expected)
		})

		it('falls back to CreateDate when DateTimeOriginal is absent', async () => {
			mockOkResponse()
			const expected = new Date('2021-07-08T12:00:00Z')
			mockedParse.mockResolvedValue({ CreateDate: expected })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toEqual(expected)
		})

		it('falls back to DateTime when DateTimeOriginal and CreateDate are absent', async () => {
			mockOkResponse()
			const expected = new Date('2020-01-15T09:00:00Z')
			mockedParse.mockResolvedValue({ DateTime: expected })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toEqual(expected)
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

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toEqual(original)
		})

		it('returns null captureDate when the date tag is not a Date instance', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ DateTimeOriginal: '2019-04-27' })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toBeNull()
		})

		it('returns null captureDate when the date tag is an invalid Date', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ DateTimeOriginal: new Date('not-a-date') })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.captureDate).toBeNull()
		})
	})

	describe('width and height', () => {
		it('returns ExifImageWidth/Height when present', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ ExifImageWidth: 4032, ExifImageHeight: 3024 })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBe(4032)
			expect(meta.height).toBe(3024)
		})

		it('falls back to PixelXDimension/PixelYDimension', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ PixelXDimension: 1920, PixelYDimension: 1080 })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBe(1920)
			expect(meta.height).toBe(1080)
		})

		it('falls back to ImageWidth/ImageHeight (TIFF tags)', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ ImageWidth: 800, ImageHeight: 600 })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBe(800)
			expect(meta.height).toBe(600)
		})

		it('prefers ExifImageWidth over PixelXDimension over ImageWidth', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({
				ExifImageWidth: 4032,
				PixelXDimension: 2016,
				ImageWidth: 1024,
				ExifImageHeight: 3024,
				PixelYDimension: 1512,
				ImageHeight: 768,
			})

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBe(4032)
			expect(meta.height).toBe(3024)
		})

		it('returns null dimensions when tags are missing', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ DateTimeOriginal: new Date('2020-01-01') })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})

		it('rounds non-integer dimensions to nearest pixel', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ ExifImageWidth: 4032.4, ExifImageHeight: 3023.7 })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBe(4032)
			expect(meta.height).toBe(3024)
		})

		it('rejects zero or negative dimensions', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ ExifImageWidth: 0, ExifImageHeight: -10 })

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta.width).toBeNull()
			expect(meta.height).toBeNull()
		})
	})

	describe('error handling', () => {
		it('sends a Range header for the EXIF segment', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({ DateTimeOriginal: new Date() })

			await extractImageMeta('https://x.test/a.jpg')

			expect(fetchSpy).toHaveBeenCalledWith('https://x.test/a.jpg', {
				headers: { Range: 'bytes=0-65535' },
			})
		})

		it('returns all-null when exifr returns undefined (no EXIF block)', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue(undefined)

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta).toEqual({ captureDate: null, width: null, height: null })
		})

		it('returns all-null when exifr returns no tags', async () => {
			mockOkResponse()
			mockedParse.mockResolvedValue({})

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta).toEqual({ captureDate: null, width: null, height: null })
		})

		it('returns all-null when exifr throws (corrupt header)', async () => {
			mockOkResponse()
			mockedParse.mockRejectedValue(new Error('bad jpeg'))

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta).toEqual({ captureDate: null, width: null, height: null })
		})

		it('returns all-null when the response is not ok (4xx/5xx)', async () => {
			fetchSpy.mockResolvedValue(new Response(null, { status: 404 }))

			const meta = await extractImageMeta('https://x.test/a.jpg')
			expect(meta).toEqual({ captureDate: null, width: null, height: null })
			expect(mockedParse).not.toHaveBeenCalled()
		})

		it('propagates network errors from fetch', async () => {
			fetchSpy.mockRejectedValue(new Error('network down'))

			await expect(extractImageMeta('https://x.test/a.jpg')).rejects.toThrow('network down')
		})
	})
})
