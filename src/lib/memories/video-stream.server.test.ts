import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createMediaCache } from '../cache/media-cache'
import {
	handleVideoStreamRequest,
	type FetchBytes,
	type ResolveStreamUrl,
} from './video-stream.server'

const VALID_UUID = '11111111-2222-4333-8444-555555555555'

const adminUser: ServerUser = {
	email: 'me@example.test',
	isAdmin: true,
} as unknown as ServerUser

function makeMediaStore(entries: Record<string, CachedMedia> = {}): MediaCacheStore {
	const data = new Map(Object.entries(entries))
	return {
		get: vi.fn<MediaCacheStore['get']>(async (uuid) => data.get(uuid)),
		set: vi.fn<MediaCacheStore['set']>(async (uuid, value) => {
			data.set(uuid, value)
		}),
		delete: vi.fn<MediaCacheStore['delete']>(async (uuid) => {
			data.delete(uuid)
		}),
		list: vi.fn<MediaCacheStore['list']>(async () => Array.from(data.keys())),
	}
}

const videoMeta: CachedMedia = {
	fileid: 300,
	hash: 'h-c',
	code: 'CODE-C',
	linkid: 3000,
	kind: 'video',
	contenttype: 'video/mp4',
	name: 'c.mp4',
	captureDate: '2018-04-27T10:00:00.000Z',
	width: 1920,
	height: 1080,
	location: null,
	place: null,
}

const imageMeta: CachedMedia = {
	...videoMeta,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
}

let resolveStreamUrl: ReturnType<typeof vi.fn<ResolveStreamUrl>>
let fetchBytes: ReturnType<typeof vi.fn<FetchBytes>>

beforeEach(() => {
	resolveStreamUrl = vi.fn<ResolveStreamUrl>(async (code) => `https://cdn.test/v?code=${code}`)
	fetchBytes = vi.fn<FetchBytes>(
		async () =>
			new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 200,
				headers: { 'content-length': '4', 'content-type': 'application/octet-stream' },
			}),
	)
})

afterEach(() => {
	vi.clearAllMocks()
})

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request('https://app.test/api/video/' + VALID_UUID, { headers })
}

describe('handleVideoStreamRequest', () => {
	it('returns 401 when the user is not signed in', async () => {
		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => null,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: videoMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(401)
		expect(resolveStreamUrl).not.toHaveBeenCalled()
		expect(fetchBytes).not.toHaveBeenCalled()
	})

	it('returns 400 for a malformed uuid', async () => {
		const res = await handleVideoStreamRequest(makeRequest(), 'not-a-uuid', {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore()),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(400)
		expect(resolveStreamUrl).not.toHaveBeenCalled()
	})

	it('returns 404 when the cache has no entry for the uuid', async () => {
		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore()),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(404)
		expect(resolveStreamUrl).not.toHaveBeenCalled()
	})

	it('returns 400 when the uuid points at an image, not a video', async () => {
		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: imageMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(400)
		expect(resolveStreamUrl).not.toHaveBeenCalled()
	})

	it('streams bytes from the resolved upstream and overrides content-type', async () => {
		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: videoMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('video/mp4')
		expect(res.headers.get('content-length')).toBe('4')
		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(resolveStreamUrl).toHaveBeenCalledWith('CODE-C')
		expect(fetchBytes).toHaveBeenCalledWith('https://cdn.test/v?code=CODE-C', null)
		const buffer = await res.arrayBuffer()
		expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]))
	})

	it('forwards the browser Range header to the upstream and propagates 206 + content-range', async () => {
		fetchBytes = vi.fn<FetchBytes>(
			async () =>
				new Response(new Uint8Array([5, 6]), {
					status: 206,
					headers: {
						'content-length': '2',
						'content-range': 'bytes 0-1/100',
					},
				}),
		)

		const res = await handleVideoStreamRequest(makeRequest({ range: 'bytes=0-1' }), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: videoMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(206)
		expect(res.headers.get('content-range')).toBe('bytes 0-1/100')
		expect(fetchBytes).toHaveBeenCalledWith('https://cdn.test/v?code=CODE-C', 'bytes=0-1')
	})

	it('returns 502 when the upstream resolver throws', async () => {
		resolveStreamUrl = vi.fn<ResolveStreamUrl>(async () => {
			throw new Error('publinkdownload failed: 410 Gone')
		})

		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: videoMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(502)
		const body = await res.text()
		expect(body).toContain('publinkdownload failed')
		expect(fetchBytes).not.toHaveBeenCalled()
	})

	it('returns 502 when the byte fetch throws', async () => {
		fetchBytes = vi.fn<FetchBytes>(async () => {
			throw new Error('upstream socket reset')
		})

		const res = await handleVideoStreamRequest(makeRequest(), VALID_UUID, {
			loadServerUser: async () => adminUser,
			mediaCache: createMediaCache(makeMediaStore({ [VALID_UUID]: videoMeta })),
			resolveStreamUrl,
			fetchBytes,
		})

		expect(res.status).toBe(502)
		const body = await res.text()
		expect(body).toContain('upstream socket reset')
	})
})
