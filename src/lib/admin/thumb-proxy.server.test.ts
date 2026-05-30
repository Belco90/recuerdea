import type { Client } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import { handleAdminThumbRequest } from './thumb-proxy.server'

function makeOkClient(): Client {
	return {
		call: vi.fn<() => Promise<{ hosts: string[]; path: string }>>(async () => ({
			hosts: ['p-cdn.pcloud.com'],
			path: '/thumb/abc.jpg',
		})),
	} as unknown as Client
}

function defaultDeps(overrides: Partial<Parameters<typeof handleAdminThumbRequest>[1]> = {}) {
	return {
		loadServerUser: async () => ({ id: 'u1', isAdmin: true }),
		makeClient: async () => makeOkClient(),
		fetchBytes: async (_url: string) =>
			new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
				status: 200,
				headers: { 'content-type': 'image/jpeg' },
			}),
		...overrides,
	}
}

describe('handleAdminThumbRequest', () => {
	it('returns 401 when there is no logged-in user', async () => {
		const res = await handleAdminThumbRequest(
			'123',
			defaultDeps({ loadServerUser: async () => null }),
		)
		expect(res.status).toBe(401)
	})

	it('returns 403 when the user is not an admin', async () => {
		const res = await handleAdminThumbRequest(
			'123',
			defaultDeps({ loadServerUser: async () => ({ id: 'u1', isAdmin: false }) }),
		)
		expect(res.status).toBe(403)
	})

	it('returns 400 for a non-integer fileid', async () => {
		const res = await handleAdminThumbRequest('abc', defaultDeps())
		expect(res.status).toBe(400)
	})

	it('returns 400 for a negative fileid', async () => {
		const res = await handleAdminThumbRequest('-1', defaultDeps())
		expect(res.status).toBe(400)
	})

	it('mints the upstream URL via getthumblink and pipes the bytes back as image/jpeg', async () => {
		const callMock = vi.fn<(method: string) => Promise<{ hosts: string[]; path: string }>>(
			async (method) => {
				if (method !== 'getthumblink') throw new Error(`unexpected: ${method}`)
				return { hosts: ['p-cdn.pcloud.com'], path: '/thumb/abc.jpg' }
			},
		)
		const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
			expect(url).toBe('https://p-cdn.pcloud.com/thumb/abc.jpg')
			return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })
		})
		const res = await handleAdminThumbRequest('42', {
			loadServerUser: async () => ({ id: 'u1', isAdmin: true }),
			makeClient: async () => ({ call: callMock }) as unknown as Client,
			fetchBytes: fetchMock,
		})

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/jpeg')
		expect(callMock).toHaveBeenCalledWith('getthumblink', {
			fileid: 42,
			type: 'jpg',
			size: '320x320',
			crop: 1,
		})
		expect(fetchMock).toHaveBeenCalledOnce()
	})

	it('sets a short private cache-control', async () => {
		const res = await handleAdminThumbRequest('42', defaultDeps())
		expect(res.headers.get('cache-control')).toMatch(/private/)
	})

	it('returns 502 when pCloud returns no hosts', async () => {
		const res = await handleAdminThumbRequest(
			'42',
			defaultDeps({
				makeClient: async () =>
					({
						call: vi.fn<() => Promise<{ hosts: string[]; path: string }>>(async () => ({
							hosts: [],
							path: '/x',
						})),
					}) as unknown as Client,
			}),
		)
		expect(res.status).toBe(502)
	})

	it('returns 502 when the upstream fetch is not ok', async () => {
		const res = await handleAdminThumbRequest(
			'42',
			defaultDeps({
				fetchBytes: async () => new Response('upstream nope', { status: 410 }),
			}),
		)
		expect(res.status).toBe(502)
	})

	it('returns 502 when getthumblink throws', async () => {
		const res = await handleAdminThumbRequest(
			'42',
			defaultDeps({
				makeClient: async () =>
					({
						call: vi.fn<() => Promise<never>>(async () => {
							throw new Error('pCloud network error on getthumblink: fetch failed')
						}),
					}) as unknown as Client,
			}),
		)
		expect(res.status).toBe(502)
	})
})
