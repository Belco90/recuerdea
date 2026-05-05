import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadAs } from './download'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('downloadAs', () => {
	it('fetches the URL, makes a blob Object URL, clicks an anchor with the download attribute, and revokes the URL', async () => {
		const blob = new Blob(['hello'], { type: 'text/plain' })
		const fetcher = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
		const objectUrl = 'blob:test:fake-url'
		const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

		let clicked: HTMLAnchorElement | null = null
		const clicker = (a: HTMLAnchorElement) => {
			clicked = a
		}

		await downloadAs({ url: 'https://example.com/a.jpg', name: 'foo.jpg', fetcher, clicker })

		expect(fetcher).toHaveBeenCalledWith('https://example.com/a.jpg')
		expect(createSpy).toHaveBeenCalledWith(blob)
		expect(clicked).not.toBeNull()
		expect(clicked!.getAttribute('href')).toBe(objectUrl)
		expect(clicked!.getAttribute('download')).toBe('foo.jpg')
		expect(revokeSpy).toHaveBeenCalledWith(objectUrl)
	})

	it('throws when the fetch response is not ok', async () => {
		const fetcher = vi.fn<typeof fetch>(async () => new Response('nope', { status: 404 }))

		await expect(
			downloadAs({
				url: 'https://example.com/missing',
				name: 'x.jpg',
				fetcher,
				clicker: () => {},
			}),
		).rejects.toThrow(/404/)
	})

	it('revokes the Object URL even when the clicker throws', async () => {
		const blob = new Blob(['x'])
		const fetcher = vi.fn<typeof fetch>(async () => new Response(blob, { status: 200 }))
		const objectUrl = 'blob:test:err'
		vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl)
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

		await expect(
			downloadAs({
				url: 'https://example.com/a',
				name: 'a',
				fetcher,
				clicker: () => {
					throw new Error('boom')
				},
			}),
		).rejects.toThrow('boom')
		expect(revokeSpy).toHaveBeenCalledWith(objectUrl)
	})
})
