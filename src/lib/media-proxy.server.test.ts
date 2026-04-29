import type { Client } from 'pcloud-kit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveMediaUrl, streamMedia } from './media-proxy.server'

type CallSig = (method: string, params?: unknown) => Promise<{ hosts: string[]; path: string }>

function makeCall(impl: CallSig) {
	return vi.fn<CallSig>(impl)
}

function clientWithCall(call: ReturnType<typeof makeCall>): Client {
	return { call: call as unknown as Client['call'] } as unknown as Client
}

describe('resolveMediaUrl', () => {
	it('image variant calls getthumblink at 2048x1024 and returns the absolute URL', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn1.pcloud.com'], path: '/p/img.jpg' }))
		const client = clientWithCall(call)

		const url = await resolveMediaUrl(client, 100, 'image', 'image/jpeg')

		expect(url).toBe('https://cdn1.pcloud.com/p/img.jpg')
		expect(call).toHaveBeenCalledWith('getthumblink', { fileid: 100, size: '2048x1024' })
	})

	it('poster variant calls getthumblink (same as image) for video posters', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn1.pcloud.com'], path: '/p/poster.jpg' }))
		const client = clientWithCall(call)

		const url = await resolveMediaUrl(client, 200, 'poster', 'video/mp4')

		expect(url).toBe('https://cdn1.pcloud.com/p/poster.jpg')
		expect(call).toHaveBeenCalledWith('getthumblink', { fileid: 200, size: '2048x1024' })
	})

	it('stream variant calls getfilelink with the original contenttype', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn2.pcloud.com'], path: '/p/v.mp4' }))
		const client = clientWithCall(call)

		const url = await resolveMediaUrl(client, 300, 'stream', 'video/mp4')

		expect(url).toBe('https://cdn2.pcloud.com/p/v.mp4')
		expect(call).toHaveBeenCalledWith('getfilelink', { fileid: 300, contenttype: 'video/mp4' })
	})

	it('throws when pCloud returns no hosts', async () => {
		const call = makeCall(async () => ({ hosts: [], path: '/p/x.jpg' }))
		const client = clientWithCall(call)

		await expect(resolveMediaUrl(client, 400, 'image', 'image/jpeg')).rejects.toThrow(
			/no hosts returned/,
		)
	})
})

describe('streamMedia', () => {
	let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch')
	})

	afterEach(() => {
		fetchSpy.mockRestore()
	})

	it('streams image bytes with cacheable headers and accept-ranges', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn.pcloud.com'], path: '/p/img.jpg' }))
		const client = clientWithCall(call)
		const upstream = new Response('IMAGE-BYTES', {
			status: 200,
			headers: { 'content-length': '11' },
		})
		fetchSpy.mockResolvedValue(upstream)

		const res = await streamMedia(client, 100, 'image', 'image/jpeg', null)

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toBe('image/jpeg')
		expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
		expect(res.headers.get('accept-ranges')).toBe('bytes')
		expect(res.headers.get('content-length')).toBe('11')
		expect(await res.text()).toBe('IMAGE-BYTES')

		const fetchCall = fetchSpy.mock.calls[0]
		expect(fetchCall?.[0]).toBe('https://cdn.pcloud.com/p/img.jpg')
		const reqInit = fetchCall?.[1] as RequestInit
		expect(new Headers(reqInit.headers).has('range')).toBe(false)
	})

	it('forwards the Range header and passes 206 + content-range through', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn.pcloud.com'], path: '/p/v.mp4' }))
		const client = clientWithCall(call)
		const upstream = new Response('PARTIAL', {
			status: 206,
			headers: {
				'content-length': '7',
				'content-range': 'bytes 0-6/9999',
			},
		})
		fetchSpy.mockResolvedValue(upstream)

		const res = await streamMedia(client, 200, 'stream', 'video/mp4', 'bytes=0-6')

		expect(res.status).toBe(206)
		expect(res.headers.get('content-type')).toBe('video/mp4')
		expect(res.headers.get('content-range')).toBe('bytes 0-6/9999')
		expect(res.headers.get('content-length')).toBe('7')

		const fetchCall = fetchSpy.mock.calls[0]
		const reqInit = fetchCall?.[1] as RequestInit
		expect(new Headers(reqInit.headers).get('range')).toBe('bytes=0-6')
	})

	it('uses the short Cache-Control TTL for video stream variant', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn.pcloud.com'], path: '/p/v.mp4' }))
		const client = clientWithCall(call)
		fetchSpy.mockResolvedValue(new Response('vid', { status: 200 }))

		const res = await streamMedia(client, 300, 'stream', 'video/mp4', null)

		expect(res.headers.get('cache-control')).toBe('public, max-age=600')
	})

	it('uses the long Cache-Control TTL for poster variant', async () => {
		const call = makeCall(async () => ({ hosts: ['cdn.pcloud.com'], path: '/p/poster.jpg' }))
		const client = clientWithCall(call)
		fetchSpy.mockResolvedValue(new Response('poster', { status: 200 }))

		const res = await streamMedia(client, 400, 'poster', 'video/mp4', null)

		expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
		expect(res.headers.get('content-type')).toBe('video/mp4')
	})
})
