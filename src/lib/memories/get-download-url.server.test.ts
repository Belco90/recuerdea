import type { Client } from 'pcloud-kit'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ServerUser } from '../auth/auth.server'
import type { CachedMedia, MediaCache } from '../cache/media-cache'
import type { DownloadUrlDeps } from './get-download-url.server'

import { resolveDownloadUrl } from './get-download-url.server'
import { resolveMediaUrl } from './pcloud-urls.server'

vi.mock('./pcloud-urls.server')

const mockedResolveMediaUrl = vi.mocked(resolveMediaUrl)

const fakeClient = {} as Client
const authedUser: ServerUser = { id: 'u', email: 'u@e.com', isAdmin: false }

const cachedImage: CachedMedia = {
	fileid: 100,
	hash: 'h-a',
	code: 'CODE-A',
	linkid: 1000,
	kind: 'image',
	contenttype: 'image/jpeg',
	name: 'a.jpg',
	captureDate: '2024-04-27T14:30:00.000Z',
	width: 4032,
	height: 3024,
	location: null,
	place: null,
}

function makeCache(entries: Record<string, CachedMedia> = {}): MediaCache {
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

function makeDeps(overrides: Partial<DownloadUrlDeps> = {}): DownloadUrlDeps {
	return {
		loadServerUser: overrides.loadServerUser ?? (async () => authedUser),
		mediaCache: overrides.mediaCache ?? makeCache({ 'uuid-a': cachedImage }),
		client: overrides.client ?? fakeClient,
	}
}

beforeEach(() => {
	mockedResolveMediaUrl.mockResolvedValue('https://cdn.example/file.jpg')
})

describe('resolveDownloadUrl', () => {
	it('returns { url, name, contenttype } on success', async () => {
		const result = await resolveDownloadUrl('uuid-a', makeDeps())

		expect(result).toEqual({
			url: 'https://cdn.example/file.jpg',
			name: 'a.jpg',
			contenttype: 'image/jpeg',
		})
		expect(mockedResolveMediaUrl).toHaveBeenCalledWith(fakeClient, 'CODE-A')
	})

	it('throws when the user is not authenticated', async () => {
		const deps = makeDeps({ loadServerUser: async () => null })

		await expect(resolveDownloadUrl('uuid-a', deps)).rejects.toThrow(/unauth/i)
		expect(mockedResolveMediaUrl).not.toHaveBeenCalled()
	})

	it('throws when the media-cache has no entry for the uuid', async () => {
		const deps = makeDeps({ mediaCache: makeCache() })

		await expect(resolveDownloadUrl('uuid-x', deps)).rejects.toThrow(/not found/i)
		expect(mockedResolveMediaUrl).not.toHaveBeenCalled()
	})

	it('propagates errors from resolveMediaUrl', async () => {
		mockedResolveMediaUrl.mockRejectedValueOnce(new Error('upstream-503'))

		await expect(resolveDownloadUrl('uuid-a', makeDeps())).rejects.toThrow('upstream-503')
	})
})
