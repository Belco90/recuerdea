import { getStore } from '@netlify/blobs'

import type { FileidIndexStore } from './fileid-index'

const STORE_NAME = 'fileid-index'
const KEY_PREFIX = 'fileid-index/'

const NOOP_STORE: FileidIndexStore = {
	async get() {
		return undefined
	},
	async set() {
		// no-op
	},
	async delete() {
		// no-op
	},
}

let cached: FileidIndexStore | undefined

export function getFileidIndexStore(): FileidIndexStore {
	if (cached) return cached
	cached = createStore()
	return cached
}

function createStore(): FileidIndexStore {
	try {
		const blobs = getStore({ name: STORE_NAME, consistency: 'eventual' })
		return {
			async get(fileid) {
				const value = await blobs.get(`${KEY_PREFIX}${fileid}`, { type: 'json' })
				return (value ?? undefined) as { uuid: string } | undefined
			},
			async set(fileid, value) {
				await blobs.setJSON(`${KEY_PREFIX}${fileid}`, value)
			},
			async delete(fileid) {
				await blobs.delete(`${KEY_PREFIX}${fileid}`)
			},
		}
	} catch {
		// eslint-disable-next-line no-console
		console.warn('[fileid-index] @netlify/blobs unavailable; running without cache.')
		return NOOP_STORE
	}
}
