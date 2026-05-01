import { getStore } from '@netlify/blobs'

import type { CachedMedia, MediaCacheStore } from './media-cache'

const STORE_NAME = 'media-cache'
const KEY_PREFIX = 'media/'

const NOOP_STORE: MediaCacheStore = {
	async get() {
		return undefined
	},
	async set() {
		// no-op when Netlify Blobs isn't reachable (e.g. plain `pnpm dev`)
	},
	async delete() {
		// no-op
	},
	async list() {
		return []
	},
}

let cached: MediaCacheStore | undefined

export function getMediaCacheStore(): MediaCacheStore {
	if (cached) return cached
	cached = createStore()
	return cached
}

function createStore(): MediaCacheStore {
	try {
		// Strong consistency is required: the cron writes entries in processFile
		// and re-reads them in runGeocodePass within the same invocation.
		// Eventual reads can return undefined for keys that were just written,
		// which silently skips every alive uuid (geocode pass attempted=0,
		// noCached=N). See PR #8 v6 location work.
		const blobs = getStore({ name: STORE_NAME, consistency: 'strong' })
		return {
			async get(uuid) {
				const value = await blobs.get(`${KEY_PREFIX}${uuid}`, { type: 'json' })
				return (value ?? undefined) as CachedMedia | undefined
			},
			async set(uuid, value) {
				await blobs.setJSON(`${KEY_PREFIX}${uuid}`, value)
			},
			async delete(uuid) {
				await blobs.delete(`${KEY_PREFIX}${uuid}`)
			},
			async list() {
				const { blobs: entries } = await blobs.list({ prefix: KEY_PREFIX })
				return entries.map((e) => e.key.slice(KEY_PREFIX.length))
			},
		}
	} catch {
		// eslint-disable-next-line no-console
		console.warn('[media-cache] @netlify/blobs unavailable; running without cache.')
		return NOOP_STORE
	}
}
