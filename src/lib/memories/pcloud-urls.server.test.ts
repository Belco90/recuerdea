import type { Client } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import { resolveMediaUrl, resolveThumbUrl } from './pcloud-urls.server'

type FakeCallRaw = (method: string, params: Record<string, unknown>) => Promise<unknown>

function makeClient(callRaw: Client['callRaw']): Client {
	return { callRaw } as Client
}

describe('resolveThumbUrl', () => {
	it('returns https://${hosts[0]}${path} for getpubthumblink at 640x640', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['c123.pcloud.com', 'c456.pcloud.com'],
			path: '/cBE/thumb.jpg',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolveThumbUrl(client, 'CODE-A', '640x640')

		expect(url).toBe('https://c123.pcloud.com/cBE/thumb.jpg')
		expect(callRaw).toHaveBeenCalledWith('getpubthumblink', { code: 'CODE-A', size: '640x640' })
	})

	it('returns the resolved URL at 1025x1025', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['c789.pcloud.com'],
			path: '/cBE/big.jpg',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolveThumbUrl(client, 'CODE-B', '1025x1025')

		expect(url).toBe('https://c789.pcloud.com/cBE/big.jpg')
		expect(callRaw).toHaveBeenCalledWith('getpubthumblink', { code: 'CODE-B', size: '1025x1025' })
	})

	it('throws when hosts is empty', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({ result: 0, hosts: [], path: '/foo' })
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveThumbUrl(client, 'CODE-A', '640x640')).rejects.toThrow(/hosts/)
	})

	it('propagates errors thrown by callRaw (e.g. PcloudApiError on result !== 0)', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockRejectedValue(new Error('result=2009 invalid file'))
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveThumbUrl(client, 'BAD', '640x640')).rejects.toThrow(
			'result=2009 invalid file',
		)
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
