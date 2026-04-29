import { getStore } from '@netlify/blobs'

import type { FolderCacheStore, FolderSnapshot } from './folder-cache'

const STORE_NAME = 'folder-cache'
const KEY = 'folder/v1'

const NOOP_STORE: FolderCacheStore = {
	async get() {
		return undefined
	},
	async set() {
		// no-op
	},
}

let cached: FolderCacheStore | undefined

export function getFolderCacheStore(): FolderCacheStore {
	if (cached) return cached
	cached = createStore()
	return cached
}

function createStore(): FolderCacheStore {
	try {
		const blobs = getStore({ name: STORE_NAME, consistency: 'eventual' })
		return {
			async get() {
				const value = await blobs.get(KEY, { type: 'json' })
				return (value ?? undefined) as FolderSnapshot | undefined
			},
			async set(value) {
				await blobs.setJSON(KEY, value)
			},
		}
	} catch {
		// eslint-disable-next-line no-console
		console.warn('[folder-cache] @netlify/blobs unavailable; running without cache.')
		return NOOP_STORE
	}
}
