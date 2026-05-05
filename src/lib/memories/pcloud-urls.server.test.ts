import type { Client } from 'pcloud-kit'

import { describe, expect, it, vi } from 'vitest'

import {
	buildThumbUrl,
	resolveMediaUrl,
	resolvePubVideoUrl,
	resolveVideoLink,
} from './pcloud-urls.server'

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

describe('resolveVideoLink', () => {
	it('passes contenttype through to getvideolink and returns https://${hosts[0]}${path}', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['p-streamer-1.pcloud.com'],
			path: '/cBE/movie.mp4',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolveVideoLink(client, 4242, { contenttype: 'video/mp4' })

		expect(url).toBe('https://p-streamer-1.pcloud.com/cBE/movie.mp4')
		expect(callRaw).toHaveBeenCalledWith('getvideolink', {
			fileid: 4242,
			contenttype: 'video/mp4',
		})
	})

	it('translates forcedownload: true to forcedownload: 1 on the wire', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['p-streamer-2.pcloud.com'],
			path: '/cBE/clip.mov',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolveVideoLink(client, 99, { forcedownload: true })

		expect(url).toBe('https://p-streamer-2.pcloud.com/cBE/clip.mov')
		expect(callRaw).toHaveBeenCalledWith('getvideolink', {
			fileid: 99,
			forcedownload: 1,
		})
	})

	it('omits forcedownload entirely when false or absent', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['p-streamer-3.pcloud.com'],
			path: '/x/y',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await resolveVideoLink(client, 1, {})
		expect(callRaw).toHaveBeenLastCalledWith('getvideolink', { fileid: 1 })

		await resolveVideoLink(client, 2, { forcedownload: false })
		expect(callRaw).toHaveBeenLastCalledWith('getvideolink', { fileid: 2 })
	})

	it('combines contenttype and forcedownload when both are provided', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			hosts: ['p-streamer-4.pcloud.com'],
			path: '/x/y',
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await resolveVideoLink(client, 7, { contenttype: 'video/mp4', forcedownload: true })

		expect(callRaw).toHaveBeenCalledWith('getvideolink', {
			fileid: 7,
			contenttype: 'video/mp4',
			forcedownload: 1,
		})
	})

	it('throws when hosts is empty', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({ result: 0, hosts: [], path: '/foo' })
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveVideoLink(client, 42, { contenttype: 'video/mp4' })).rejects.toThrow(
			/hosts/,
		)
	})

	it('propagates errors thrown by callRaw', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockRejectedValue(new Error('network'))
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolveVideoLink(client, 42, { forcedownload: true })).rejects.toThrow('network')
	})
})

describe('resolvePubVideoUrl', () => {
	type PubVideoVariant = {
		isoriginal?: boolean
		videocodec?: string
		audiocodec?: string
		width?: number
		height?: number
		hosts: readonly string[]
		path: string
	}

	const transcoded720: PubVideoVariant = {
		isoriginal: false,
		videocodec: 'h264',
		audiocodec: 'aac',
		width: 1280,
		height: 720,
		hosts: ['c-streamer-720.pcloud.com'],
		path: '/v1/720p.mp4',
	}
	const transcoded480: PubVideoVariant = {
		isoriginal: false,
		videocodec: 'h264',
		audiocodec: 'aac',
		width: 854,
		height: 480,
		hosts: ['c-streamer-480.pcloud.com'],
		path: '/v1/480p.mp4',
	}
	const original: PubVideoVariant = {
		isoriginal: true,
		videocodec: 'hevc',
		audiocodec: 'aac',
		width: 3840,
		height: 2160,
		hosts: ['c-orig.pcloud.com'],
		path: '/orig/source.mov',
	}

	it('calls getpubvideolinks with the public-link code', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({ result: 0, variants: [transcoded720] })
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await resolvePubVideoUrl(client, 'CODE-V')

		expect(callRaw).toHaveBeenCalledWith('getpubvideolinks', { code: 'CODE-V' })
	})

	it('picks the largest non-original H.264 variant', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			variants: [transcoded480, transcoded720, original],
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolvePubVideoUrl(client, 'CODE-V')

		expect(url).toBe('https://c-streamer-720.pcloud.com/v1/720p.mp4')
	})

	it('falls back to any H.264 variant (including original) if no non-original transcode exists', async () => {
		const h264Original: PubVideoVariant = { ...original, videocodec: 'h264' }
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			variants: [h264Original],
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolvePubVideoUrl(client, 'CODE-V')

		expect(url).toBe('https://c-orig.pcloud.com/orig/source.mov')
	})

	it('falls back to the first variant when no H.264 variant exists', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			variants: [original],
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		const url = await resolvePubVideoUrl(client, 'CODE-V')

		expect(url).toBe('https://c-orig.pcloud.com/orig/source.mov')
	})

	it('throws when variants is empty', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({ result: 0, variants: [] })
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolvePubVideoUrl(client, 'CODE-V')).rejects.toThrow(/variants/)
	})

	it('throws when the picked variant has no hosts', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockResolvedValue({
			result: 0,
			variants: [{ ...transcoded720, hosts: [] }],
		})
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolvePubVideoUrl(client, 'CODE-V')).rejects.toThrow(/hosts/)
	})

	it('propagates errors thrown by callRaw', async () => {
		const callRaw = vi.fn<FakeCallRaw>().mockRejectedValue(new Error('network'))
		const client = makeClient(callRaw as unknown as Client['callRaw'])

		await expect(resolvePubVideoUrl(client, 'CODE-V')).rejects.toThrow('network')
	})
})
