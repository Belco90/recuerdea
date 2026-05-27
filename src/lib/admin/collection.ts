import { createServerFn } from '@tanstack/react-start'

import type { AdminFileItem } from './collection.server'

export type { AdminFileItem }

export type CollectionMediaResult = { status: 'ok'; items: AdminFileItem[] }

type UuidsInput = { uuids: readonly string[] }

function parseUuidsInput(input: unknown): UuidsInput | null {
	if (!input || typeof input !== 'object') return null
	const obj = input as Record<string, unknown>
	if (!Array.isArray(obj.uuids)) return null
	if (obj.uuids.length === 0) return null
	if (!obj.uuids.every((u): u is string => typeof u === 'string' && u.length > 0)) return null
	return { uuids: obj.uuids as readonly string[] }
}

async function gateAdmin(): Promise<void> {
	const { loadServerUser } = await import('../auth/auth.server')
	const user = await loadServerUser()
	if (!user) throw new Error('unauthenticated')
	if (!user.isAdmin) throw new Error('forbidden')
}

async function makeStores() {
	const { createCollectionCache } = await import('../cache/collection-cache')
	const { getCollectionCacheStore } = await import('../cache/collection-cache.server')
	const { createMediaCache } = await import('../cache/media-cache')
	const { getMediaCacheStore } = await import('../cache/media-cache.server')
	return {
		collection: createCollectionCache(getCollectionCacheStore()),
		media: createMediaCache(getMediaCacheStore()),
	}
}

export const getCollectionMedia = createServerFn({ method: 'GET' }).handler(
	async (): Promise<CollectionMediaResult> => {
		await gateAdmin()
		const { fetchCuratedItems } = await import('./collection.server')
		const { collection, media } = await makeStores()
		const items = await fetchCuratedItems(collection, media)
		return { status: 'ok', items }
	},
)

export const addToCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): UuidsInput | null => parseUuidsInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const { addUuidsToCollection } = await import('./collection.server')
		const { collection } = await makeStores()
		await addUuidsToCollection(collection, data.uuids)
	})

export const removeFromCollection = createServerFn({ method: 'POST' })
	.inputValidator((input: unknown): UuidsInput | null => parseUuidsInput(input))
	.handler(async ({ data }): Promise<void> => {
		if (!data) throw new Error('invalid input')
		await gateAdmin()
		const { removeUuidsFromCollection } = await import('./collection.server')
		const { collection } = await makeStores()
		await removeUuidsFromCollection(collection, data.uuids)
	})
