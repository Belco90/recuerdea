export type CaptureCacheValue = { hash: string; captureDate: string | null }

export type CaptureCacheStore = {
	get(fileid: number): Promise<CaptureCacheValue | undefined>
	set(fileid: number, value: CaptureCacheValue): Promise<void>
}

export type CaptureCache = {
	lookup(fileid: number, hash: string): Promise<Date | null | undefined>
	remember(fileid: number, hash: string, captureDate: Date | null): Promise<void>
}

export function createCaptureCache(store: CaptureCacheStore): CaptureCache {
	return {
		async lookup(fileid, hash) {
			const entry = await store.get(fileid)
			if (!entry || entry.hash !== hash) return undefined
			if (entry.captureDate === null) return null
			const date = new Date(entry.captureDate)
			return Number.isNaN(date.getTime()) ? undefined : date
		},
		async remember(fileid, hash, captureDate) {
			await store.set(fileid, {
				hash,
				captureDate: captureDate ? captureDate.toISOString() : null,
			})
		},
	}
}
