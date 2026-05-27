import { describe, expect, it, vi } from 'vitest'

import type { FolderCacheStore, FolderSnapshot } from '../cache/folder-cache'
import type { CachedMedia, MediaCacheStore } from '../cache/media-cache'

import { createFolderCache } from '../cache/folder-cache'
import { createMediaCache } from '../cache/media-cache'
import { fetchAdminFolderMedia } from './folder-media.server'

function makeFolderStore(initial?: FolderSnapshot) {
	const state: { value: FolderSnapshot | undefined } = { value: initial }
	const get = vi.fn<FolderCacheStore['get']>(async () => state.value)
	const set = vi.fn<FolderCacheStore['set']>(async (next) => {
		state.value = next
	})
	return { get, set, state } satisfies FolderCacheStore & { state: typeof state }
}

function makeMediaStore() {
	const data = new Map<string, CachedMedia>()
	const get = vi.fn<MediaCacheStore['get']>(async (uuid) => data.get(uuid))
	const set = vi.fn<MediaCacheStore['set']>(async (uuid, value) => {
		data.set(uuid, value)
	})
	const del = vi.fn<MediaCacheStore['delete']>(async (uuid) => {
		data.delete(uuid)
	})
	const list = vi.fn<MediaCacheStore['list']>(async () => Array.from(data.keys()))
	return { get, set, delete: del, list, data } satisfies MediaCacheStore & {
		data: typeof data
	}
}

function makeCached(overrides: Partial<CachedMedia> = {}): CachedMedia {
	return {
		fileid: 100,
		hash: 'abc',
		code: 'CODE',
		linkid: 1,
		kind: 'image',
		contenttype: 'image/jpeg',
		name: 'a.jpg',
		captureDate: null,
		width: null,
		height: null,
		location: null,
		place: null,
		...overrides,
	}
}

describe('fetchAdminFolderMedia', () => {
	it('returns [] when the folder snapshot is missing', async () => {
		const folder = createFolderCache(makeFolderStore())
		const media = createMediaCache(makeMediaStore())

		expect(await fetchAdminFolderMedia(folder, media)).toEqual([])
	})

	it('returns [] when the folder snapshot is empty', async () => {
		const folder = createFolderCache(
			makeFolderStore({ refreshedAt: '2026-05-27T00:00:00.000Z', uuids: [] }),
		)
		const media = createMediaCache(makeMediaStore())

		expect(await fetchAdminFolderMedia(folder, media)).toEqual([])
	})

	it('maps folder uuids into AdminFileItem[] in snapshot order', async () => {
		const folder = createFolderCache(
			makeFolderStore({
				refreshedAt: '2026-05-27T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-B'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCached({ code: 'CODE-A', name: 'a.jpg', kind: 'image' }))
		mediaStore.data.set(
			'uuid-B',
			makeCached({ code: 'CODE-B', name: 'b.mp4', kind: 'video', contenttype: 'video/mp4' }),
		)
		const media = createMediaCache(mediaStore)

		const result = await fetchAdminFolderMedia(folder, media)

		expect(result).toEqual([
			{
				uuid: 'uuid-A',
				name: 'a.jpg',
				kind: 'image',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-A&size=320x320',
			},
			{
				uuid: 'uuid-B',
				name: 'b.mp4',
				kind: 'video',
				thumbUrl: 'https://eapi.pcloud.com/getpubthumb?code=CODE-B&size=320x320',
			},
		])
	})

	it('silently drops uuids whose media-cache entry is missing', async () => {
		const folder = createFolderCache(
			makeFolderStore({
				refreshedAt: '2026-05-27T00:00:00.000Z',
				uuids: ['uuid-A', 'uuid-GONE', 'uuid-B'],
			}),
		)
		const mediaStore = makeMediaStore()
		mediaStore.data.set('uuid-A', makeCached({ code: 'CODE-A', name: 'a.jpg' }))
		mediaStore.data.set('uuid-B', makeCached({ code: 'CODE-B', name: 'b.jpg' }))
		const media = createMediaCache(mediaStore)

		const result = await fetchAdminFolderMedia(folder, media)

		expect(result.map((i) => i.uuid)).toEqual(['uuid-A', 'uuid-B'])
	})
})
