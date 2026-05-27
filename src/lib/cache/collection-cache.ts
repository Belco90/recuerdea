export type CollectionSnapshot = {
	refreshedAt: string
	uuids: readonly string[]
}

export type CollectionCacheStore = {
	get(): Promise<CollectionSnapshot | undefined>
	set(value: CollectionSnapshot): Promise<void>
}

export type CollectionCache = {
	lookup(): Promise<CollectionSnapshot | undefined>
	remember(value: CollectionSnapshot): Promise<void>
}

export function createCollectionCache(store: CollectionCacheStore): CollectionCache {
	return {
		async lookup() {
			return store.get()
		},
		async remember(value) {
			await store.set(value)
		},
	}
}
