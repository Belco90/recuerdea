import { describe, expect, it, vi } from 'vitest'

import type { ServerUser } from './auth.server'
import type { CachedMedia, MediaCache } from './media-cache'
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

	it('returns 404 when the uuid is not in the cache', async () => {
		const res = await handleMemoryRequest(makeRequest(), VALID_UUID, makeDeps())
		expect(res.status).toBe(404)
	})

	it('image (default for kind=image) → fetches getpubthumb URL and pipes bytes', async () => {
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
			'https://eapi.pcloud.com/getpubthumb?code=IMG-CODE&size=2048x1024',
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

	it('explicit variant=poster on a video → fetches getpubthumb', async () => {
		const fetchBytes = vi.fn<FetchBytes>(async () => new Response('poster', { status: 200 }))
		const deps = makeDeps({ entries: { [VALID_UUID]: videoMeta }, fetchBytes })

		const res = await handleMemoryRequest(makeRequest('poster'), VALID_UUID, deps)

		expect(fetchBytes).toHaveBeenCalledWith(
			'https://eapi.pcloud.com/getpubthumb?code=VID-CODE&size=2048x1024',
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

	it('encodes the code in the upstream URL (defense against odd characters)', async () => {
		const odd: CachedMedia = { ...imageMeta, code: 'a/b c' }
		const fetchBytes = vi.fn<FetchBytes>(async () => new Response('ok', { status: 200 }))
		const deps = makeDeps({ entries: { [VALID_UUID]: odd }, fetchBytes })

		await handleMemoryRequest(makeRequest(), VALID_UUID, deps)

		expect(fetchBytes).toHaveBeenCalledWith(
			'https://eapi.pcloud.com/getpubthumb?code=a%2Fb%20c&size=2048x1024',
			null,
		)
	})
})
