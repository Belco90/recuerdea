import { getStore } from '@netlify/blobs'

import type { CollectionCacheStore, CollectionSnapshot } from './collection-cache'

const STORE_NAME = 'collection-cache'
const KEY = 'collection/v1'

const NOOP_STORE: CollectionCacheStore = {
	async get() {
		return undefined
	},
	async set() {
		// no-op
	},
}

let cached: CollectionCacheStore | undefined

export function getCollectionCacheStore(): CollectionCacheStore {
	if (cached) return cached
	cached = createStore()
	return cached
}

function createStore(): CollectionCacheStore {
	try {
		const blobs = getStore({ name: STORE_NAME, consistency: 'eventual' })
		return {
			async get() {
				const value = await blobs.get(KEY, { type: 'json' })
				return (value ?? undefined) as CollectionSnapshot | undefined
			},
			async set(value) {
				await blobs.setJSON(KEY, value)
			},
		}
	} catch {
		// eslint-disable-next-line no-console
		console.warn('[collection-cache] @netlify/blobs unavailable; running without cache.')
		return NOOP_STORE
	}
}
