import type { Client } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import { buildThumbUrl, resolveMediaUrl } from './pcloud-urls.server'

type FakeCallRaw = (method: string, params: Record<string, unknown>) => Promise<unknown>

function makeClient(callRaw: Client['callRaw']): Client {
	return { callRaw } as Client
}

describe('buildThumbUrl', () => {
	it('returns the direct eapi.pcloud.com getpubthumb URL at 640x640', () => {
		expect(buildThumbUrl('CODE-A', '640x640')).toBe(
			'https://eapi.pcloud.com/getpubthumb?code=CODE-A&size=640x640',
		)
	})

	it('returns the direct eapi.pcloud.com getpubthumb URL at 1025x1025', () => {
		expect(buildThumbUrl('CODE-B', '1025x1025')).toBe(
			'https://eapi.pcloud.com/getpubthumb?code=CODE-B&size=1025x1025',
		)
	})

	it('URL-encodes the code parameter', () => {
		expect(buildThumbUrl('a/b c', '640x640')).toBe(
			'https://eapi.pcloud.com/getpubthumb?code=a%2Fb%20c&size=640x640',
		)
	})

	it('does not produce a CDN-host URL — those are IP-bound and break browser fetches', () => {
		const url = buildThumbUrl('CODE-A', '640x640')
		expect(url.startsWith('https://eapi.pcloud.com/')).toBe(true)
		expect(url).not.toContain('c123.pcloud.com')
	})
})

describe('resolveMediaUrl', () => {
	it('returns https://${hosts[0]}${path} for getpublinkdownload', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['p-streamer-1.pcloud.com'],
			path: '/cBE/movie.mp4',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolveMediaUrl(client, 'CODE-V')

		expect(url).toBe('https://p-streamer-1.pcloud.com/cBE/movie.mp4')
		expect(callRaw).toHaveBeenCalledWith('getpublinkdownload', { code: 'CODE-V' })
	})

	it('throws when hosts is empty', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({ result: 0, hosts: [], path: '/foo' })
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveMediaUrl(client, 'CODE-V')).rejects.toThrow(/hosts/)
	})

	it('propagates errors thrown by callRaw', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockRejectedValue(new Error('network'))
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveMediaUrl(client, 'CODE-V')).rejects.toThrow('network')
	})
})
