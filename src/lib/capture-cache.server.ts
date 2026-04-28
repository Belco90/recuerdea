import { getStore } from '@netlify/blobs'

import type { CaptureCacheStore, CaptureCacheValue } from './capture-cache'

const STORE_NAME = 'capture-date-cache'
const KEY_PREFIX = 'v1/'

const NOOP_STORE: CaptureCacheStore = {
	async get() {
		return undefined
	},
	async set() {
		// no-op when Netlify Blobs isn't reachable (e.g. plain `pnpm dev`)
	},
}

let cached: CaptureCacheStore | undefined

export function getCaptureCacheStore(): CaptureCacheStore {
	if (cached) return cached
	cached = createStore()
	return cached
}

function createStore(): CaptureCacheStore {
	try {
		const blobs = getStore({ name: STORE_NAME, consistency: 'eventual' })
		return {
			async get(fileid) {
				const value = await blobs.get(`${KEY_PREFIX}${fileid}`, { type: 'json' })
				return (value ?? undefined) as CaptureCacheValue | undefined
			},
			async set(fileid, value) {
				await blobs.setJSON(`${KEY_PREFIX}${fileid}`, value)
			},
		}
	} catch {
		// eslint-disable-next-line no-console
		console.warn('[capture-cache] @netlify/blobs unavailable; running without cache.')
		return NOOP_STORE
	}
}
