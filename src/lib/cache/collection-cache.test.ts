import { describe, expect, it, vi } from 'vitest'

import type { CollectionCacheStore, CollectionSnapshot } from './collection-cache'

import { createCollectionCache } from './collection-cache'

function makeFakeStore() {
	const state: { value: CollectionSnapshot | undefined } = { value: undefined }
	const get = vi.fn<CollectionCacheStore['get']>(async () => state.value)
	const set = vi.fn<CollectionCacheStore['set']>(async (next) => {
		state.value = next
	})
	return { get, set, state } satisfies CollectionCacheStore & { state: typeof state }
}

const snap: CollectionSnapshot = {
	refreshedAt: '2026-04-29T04:00:00.000Z',
	uuids: ['a', 'b'],
}

describe('createCollectionCache', () => {
	it('lookup returns undefined when no snapshot has been written', async () => {
		const cache = createCollectionCache(makeFakeStore())
		expect(await cache.lookup()).toBeUndefined()
	})

	it('remember + lookup round-trips the snapshot', async () => {
		const store = makeFakeStore()
		const cache = createCollectionCache(store)

		await cache.remember(snap)

		expect(store.set).toHaveBeenCalledWith(snap)
		expect(await cache.lookup()).toEqual(snap)
	})

	it('remember overwrites a previous snapshot', async () => {
		const store = makeFakeStore()
		const cache = createCollectionCache(store)

		await cache.remember(snap)
		const next: CollectionSnapshot = { refreshedAt: '2026-04-30T04:00:00.000Z', uuids: ['c'] }
		await cache.remember(next)

		expect(await cache.lookup()).toEqual(next)
	})
})
