import { describe, expect, it, vi } from 'vitest'

import type { FolderCacheStore, FolderSnapshot } from './folder-cache'

import { createFolderCache } from './folder-cache'

function makeFakeStore() {
	const state: { value: FolderSnapshot | undefined } = { value: undefined }
	const get = vi.fn<FolderCacheStore['get']>(async () => state.value)
	const set = vi.fn<FolderCacheStore['set']>(async (next) => {
		state.value = next
	})
	return { get, set, state } satisfies FolderCacheStore & { state: typeof state }
}

const snap: FolderSnapshot = {
	refreshedAt: '2026-04-29T04:00:00.000Z',
	uuids: ['a', 'b', 'c'],
}

describe('createFolderCache', () => {
	it('lookup returns undefined when no snapshot has been written', async () => {
		const cache = createFolderCache(makeFakeStore())
		expect(await cache.lookup()).toBeUndefined()
	})

	it('remember + lookup round-trips the snapshot', async () => {
		const store = makeFakeStore()
		const cache = createFolderCache(store)

		await cache.remember(snap)

		expect(store.set).toHaveBeenCalledWith(snap)
		expect(await cache.lookup()).toEqual(snap)
	})

	it('remember overwrites a previous snapshot', async () => {
		const store = makeFakeStore()
		const cache = createFolderCache(store)

		await cache.remember(snap)
		const next: FolderSnapshot = { refreshedAt: '2026-04-30T04:00:00.000Z', uuids: ['c', 'd'] }
		await cache.remember(next)

		expect(await cache.lookup()).toEqual(next)
	})
})
