import type { Client } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import { resolveMediaUrl } from './media-proxy.server'

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
