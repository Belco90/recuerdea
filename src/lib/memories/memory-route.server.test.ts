import { describe, expect, it, vi } from 'vitest'

import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCache } from '../cache/media-cache'
import type { FetchBytes, MemoryRequestDeps, ResolveStreamUrl } from './memory-route.server'

import { handleMemoryRequest } from './memory-route.server'

const VALID_UUID = '11111111-2222-4333-8444-555555555555'

const imageMeta: CachedMedia = {
	fileid: 100,
	hash: 'h-a',
	code: 'IMG-CODE',
	linkid: 1000,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
	captureDate: '2020-04-27T10:00:00.000Z',
	width: 4032,
	height: 3024,
	location: null,
	place: null,
}

const videoMeta: CachedMedia = {
	fileid: 200,
	hash: 'h-b',
	code: 'VID-CODE',
	linkid: 2000,
	kind: 'video',
	contenttype: 'video/mp4',
	name: 'b.mp4',
	captureDate: '2018-04-27T10:00:00.000Z',
	width: 1920,
	height: 1080,
	location: null,
	place: null,
}

function makeMediaCache(entries: Record<string, CachedMedia> = {}): MediaCache {
	return {
		async lookup(uuid) {
			return entries[uuid]
		},
		async remember() {},
		async forget() {},
		async listUuids() {
			return Object.keys(entries)
		},
	}
}

const authedUser: ServerUser = { id: 'u', email: 'u@e.com', isAdmin: false }

function makeDeps(
	overrides: Partial<MemoryRequestDeps> & { entries?: Record<string, CachedMedia> } = {},
): MemoryRequestDeps {
	return {
		loadServerUser: overrides.loadServerUser ?? (async () => authedUser),
		mediaCache: overrides.mediaCache ?? makeMediaCache(overrides.entries),
		resolveStreamUrl:
			overrides.resolveStreamUrl ?? (async (code) => `https://e1.pcloud.com/dl/${code}`),
		fetchBytes:
			overrides.fetchBytes ??
			(async () =>
				new Response('upstream-bytes', {
					status: 200,
					headers: { 'content-length': '14' },
				})),
	}
}

function makeRequest(variant?: string, range?: string): Request {
	const search = variant ? `?variant=${variant}` : ''
	const headers = range ? { range } : undefined
	return new Request(`https://example.com/api/memory/${VALID_UUID}${search}`, { headers })
}

describe('handleMemoryRequest', () => {
	it('returns 401 when the caller is not authenticated', async () => {
		const deps = makeDeps({ loadServerUser: async () => null })
		const res = await handleMemoryRequest(makeRequest(), VALID_UUID, deps)
		expect(res.status).toBe(401)
	})

	it('returns 400 when the uuid is malformed', async () => {
		const res = await handleMemoryRequest(
			new Request('https://example.com/api/memory/not-a-uuid'),
			'not-a-uuid',
			makeDeps(),
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 when the variant is unrecognized', async () => {
		const res = await handleMemoryRequest(
			makeRequest('bogus'),
			VALID_UUID,
			makeDeps({ entries: { [VALID_UUID]: imageMeta } }),
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 for the removed image variant', async () => {
		const res = await handleMemoryRequest(
			makeRequest('image'),
			VALID_UUID,
			makeDeps({ entries: { [VALID_UUID]: imageMeta } }),
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 for the removed poster variant', async () => {
		const res = await handleMemoryRequest(
			makeRequest('poster'),
			VALID_UUID,
			makeDeps({ entries: { [VALID_UUID]: videoMeta } }),
		)
		expect(res.status).toBe(400)
	})

	it('returns 404 when the uuid is not in the cache', async () => {
		const res = await handleMemoryRequest(makeRequest(), VALID_UUID, makeDeps())
		expect(res.status).toBe(404)
	})

	it('thumb (default for kind=image) → fetches getpubthumb URL at 640x640 and pipes bytes', async () => {
		const fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response('image-bytes', {
					status: 200,
					headers: { 'content-length': '11', 'content-type': 'image/jpeg' },
				}),
		)
		const deps = makeDeps({ entries: { [VALID_UUID]: imageMeta }, fetchBytes })

		const res = await handleMemoryRequest(makeRequest(), VALID_UUID, deps)

		expect(fetchBytes).toHaveBeenCalledWith(
			'https://eapi.pcloud.com/getpubthumb?code=IMG-CODE&size=640x640',
			null,
		)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/jpeg')
		expect(res.headers.get('cache-control')).toContain('immutable')
		expect(res.headers.get('content-length')).toBe('11')
		// No Location header — public-link URL must not leak to the browser.
		expect(res.headers.get('location')).toBeNull()
		expect(await res.text()).toBe('image-bytes')
	})

	it('explicit variant=thumb on a video → fetches getpubthumb at 640x640', async () => {
		const fetchBytes = vi.fn<FetchBytes>(async () => new Response('poster', { status: 200 }))
		const deps = makeDeps({ entries: { [VALID_UUID]: videoMeta }, fetchBytes })

		const res = await handleMemoryRequest(makeRequest('thumb'), VALID_UUID, deps)

		expect(fetchBytes).toHaveBeenCalledWith(
			'https://eapi.pcloud.com/getpubthumb?code=VID-CODE&size=640x640',
			null,
		)
		expect(res.status).toBe(200)
	})

	it('stream (default for kind=video) → resolves CDN URL then pipes bytes with Range', async () => {
		const resolveStreamUrl = vi.fn<ResolveStreamUrl>(
			async (code) => `https://e1.pcloud.com/dl/${code}`,
		)
		const fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response('partial', {
					status: 206,
					headers: {
						'content-length': '7',
						'content-range': 'bytes 0-6/100',
					},
				}),
		)
		const deps = makeDeps({
			entries: { [VALID_UUID]: videoMeta },
			resolveStreamUrl,
			fetchBytes,
		})

		const res = await handleMemoryRequest(makeRequest(undefined, 'bytes=0-6'), VALID_UUID, deps)

		expect(resolveStreamUrl).toHaveBeenCalledWith('VID-CODE')
		expect(fetchBytes).toHaveBeenCalledWith('https://e1.pcloud.com/dl/VID-CODE', 'bytes=0-6')
		expect(res.status).toBe(206)
		expect(res.headers.get('content-type')).toBe('video/mp4')
		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(res.headers.get('content-range')).toBe('bytes 0-6/100')
		expect(res.headers.get('content-length')).toBe('7')
		expect(res.headers.get('cache-control')).toContain('max-age=60')
		expect(res.headers.get('location')).toBeNull()
	})

	it('returns 502 when resolveStreamUrl throws', async () => {
		const deps = makeDeps({
			entries: { [VALID_UUID]: videoMeta },
			resolveStreamUrl: async () => {
				throw new Error('upstream down')
			},
		})
		const res = await handleMemoryRequest(makeRequest('stream'), VALID_UUID, deps)

		expect(res.status).toBe(502)
		expect(await res.text()).toContain('upstream down')
	})

	it('returns 502 when fetchBytes throws', async () => {
		const deps = makeDeps({
			entries: { [VALID_UUID]: imageMeta },
			fetchBytes: async () => {
				throw new Error('network down')
			},
		})
		const res = await handleMemoryRequest(makeRequest(), VALID_UUID, deps)

		expect(res.status).toBe(502)
		expect(await res.text()).toContain('network down')
	})

	it('encodes the code in the upstream thumb URL (defense against odd characters)', async () => {
		const odd: CachedMedia = { ...imageMeta, code: 'a/b c' }
		const fetchBytes = vi.fn<FetchBytes>(async () => new Response('ok', { status: 200 }))
		const deps = makeDeps({ entries: { [VALID_UUID]: odd }, fetchBytes })

		await handleMemoryRequest(makeRequest(), VALID_UUID, deps)

		expect(fetchBytes).toHaveBeenCalledWith(
			'https://eapi.pcloud.com/getpubthumb?code=a%2Fb%20c&size=640x640',
			null,
		)
	})

	it('download (image) → resolves CDN URL, ignores Range, returns 200 with attachment', async () => {
		const resolveStreamUrl = vi.fn<ResolveStreamUrl>(
			async (code) => `https://e1.pcloud.com/dl/${code}`,
		)
		const fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response('original-bytes', {
					status: 200,
					headers: { 'content-length': '14', 'content-type': 'image/jpeg' },
				}),
		)
		const deps = makeDeps({
			entries: { [VALID_UUID]: imageMeta },
			resolveStreamUrl,
			fetchBytes,
		})

		const res = await handleMemoryRequest(makeRequest('download', 'bytes=0-100'), VALID_UUID, deps)

		expect(resolveStreamUrl).toHaveBeenCalledWith('IMG-CODE')
		// Range must NOT be forwarded for downloads.
		expect(fetchBytes).toHaveBeenCalledWith('https://e1.pcloud.com/dl/IMG-CODE', null)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/jpeg')
		const disposition = res.headers.get('content-disposition') ?? ''
		expect(disposition).toContain('attachment')
		expect(disposition).toContain("filename*=UTF-8''a.jpg")
		expect(disposition).toContain('filename="a.jpg"')
		expect(res.headers.get('cache-control')).toContain('no-store')
		expect(res.headers.get('location')).toBeNull()
	})

	it('download (video) → resolves CDN URL, returns 200 with attachment disposition', async () => {
		const resolveStreamUrl = vi.fn<ResolveStreamUrl>(
			async (code) => `https://e1.pcloud.com/dl/${code}`,
		)
		const fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response('mp4-bytes', {
					status: 200,
					headers: { 'content-length': '9', 'content-type': 'video/mp4' },
				}),
		)
		const deps = makeDeps({
			entries: { [VALID_UUID]: videoMeta },
			resolveStreamUrl,
			fetchBytes,
		})

		const res = await handleMemoryRequest(makeRequest('download'), VALID_UUID, deps)

		expect(resolveStreamUrl).toHaveBeenCalledWith('VID-CODE')
		expect(fetchBytes).toHaveBeenCalledWith('https://e1.pcloud.com/dl/VID-CODE', null)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('video/mp4')
		const disposition = res.headers.get('content-disposition') ?? ''
		expect(disposition).toContain('attachment')
		expect(disposition).toContain("filename*=UTF-8''b.mp4")
		expect(res.headers.get('cache-control')).toContain('no-store')
	})

	it('download → encodes accents, spaces and emoji per RFC 5987 with ASCII fallback', async () => {
		const tricky: CachedMedia = { ...imageMeta, name: 'café 🌅 día.jpg' }
		const deps = makeDeps({ entries: { [VALID_UUID]: tricky } })

		const res = await handleMemoryRequest(makeRequest('download'), VALID_UUID, deps)

		const disposition = res.headers.get('content-disposition') ?? ''
		expect(disposition).toContain('attachment')
		// RFC 5987 percent-encoded UTF-8 form keeps the original characters intact.
		expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('café 🌅 día.jpg')}`)
		// ASCII fallback strips the non-ASCII bytes — must remain a quoted string.
		const asciiFallback = disposition.match(/filename="([^"]*)"/)?.[1]
		expect(asciiFallback).toBeTruthy()
		expect(asciiFallback).toMatch(/^[\x20-\x7e]*$/)
		expect(asciiFallback).not.toContain('"')
	})

	it('download → forces 200 even if upstream returns 206 with content-range', async () => {
		const fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response('partial', {
					status: 206,
					headers: {
						'content-length': '7',
						'content-range': 'bytes 0-6/100',
					},
				}),
		)
		const deps = makeDeps({
			entries: { [VALID_UUID]: imageMeta },
			fetchBytes,
		})

		const res = await handleMemoryRequest(makeRequest('download', 'bytes=0-6'), VALID_UUID, deps)

		expect(res.status).toBe(200)
		expect(res.headers.get('content-range')).toBeNull()
	})
})
