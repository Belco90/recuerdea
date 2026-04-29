export type FolderSnapshot = {
	refreshedAt: string
	uuids: readonly string[]
}

export type FolderCacheStore = {
	get(): Promise<FolderSnapshot | undefined>
	set(value: FolderSnapshot): Promise<void>
}

export type FolderCache = {
	lookup(): Promise<FolderSnapshot | undefined>
	remember(value: FolderSnapshot): Promise<void>
}

export function createFolderCache(store: FolderCacheStore): FolderCache {
	return {
		async lookup() {
			return store.get()
		},
		async remember(value) {
			await store.set(value)
		},
	}
}
