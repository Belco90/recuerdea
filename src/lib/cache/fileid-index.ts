export type FileidIndexStore = {
	get(fileid: number): Promise<{ uuid: string } | undefined>
	set(fileid: number, value: { uuid: string }): Promise<void>
	delete(fileid: number): Promise<void>
}

export type FileidIndex = {
	lookup(fileid: number): Promise<string | undefined>
	remember(fileid: number, uuid: string): Promise<void>
	forget(fileid: number): Promise<void>
}

export function createFileidIndex(store: FileidIndexStore): FileidIndex {
	return {
		async lookup(fileid) {
			const entry = await store.get(fileid)
			return entry?.uuid
		},
		async remember(fileid, uuid) {
			await store.set(fileid, { uuid })
		},
		async forget(fileid) {
			await store.delete(fileid)
		},
	}
}
