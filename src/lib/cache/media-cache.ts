export type CachedMedia = {
	fileid: number
	hash: string
	code: string
	linkid: number
	kind: 'image' | 'video'
	contenttype: string
	name: string
	captureDate: string | null
	width: number | null
	height: number | null
	location: { lat: number; lng: number } | null
	place: string | null
}

export type MediaCacheStore = {
	get(uuid: string): Promise<CachedMedia | undefined>
	set(uuid: string, value: CachedMedia): Promise<void>
	delete(uuid: string): Promise<void>
	list(): Promise<readonly string[]>
}

export type MediaCache = {
	lookup(uuid: string): Promise<CachedMedia | undefined>
	remember(uuid: string, value: CachedMedia): Promise<void>
	forget(uuid: string): Promise<void>
	listUuids(): Promise<readonly string[]>
}

export function createMediaCache(store: MediaCacheStore): MediaCache {
	return {
		async lookup(uuid) {
			return store.get(uuid)
		},
		async remember(uuid, value) {
			await store.set(uuid, value)
		},
		async forget(uuid) {
			await store.delete(uuid)
		},
		async listUuids() {
			return store.list()
		},
	}
}
