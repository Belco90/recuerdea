import { describe, expect, it, vi } from 'vitest'

import type { FileidIndexStore } from './fileid-index'

import { createFileidIndex } from './fileid-index'

function makeFakeStore() {
	const data = new Map<number, { uuid: string }>()
	const get = vi.fn<FileidIndexStore['get']>(async (fileid) => data.get(fileid))
	const set = vi.fn<FileidIndexStore['set']>(async (fileid, value) => {
		data.set(fileid, value)
	})
	const del = vi.fn<FileidIndexStore['delete']>(async (fileid) => {
		data.delete(fileid)
	})
	return { get, set, delete: del, data } satisfies FileidIndexStore & { data: typeof data }
}

describe('createFileidIndex', () => {
	it('lookup returns undefined on miss', async () => {
		const idx = createFileidIndex(makeFakeStore())
		expect(await idx.lookup(123)).toBeUndefined()
	})

	it('lookup returns the uuid when one is stored', async () => {
		const store = makeFakeStore()
		store.data.set(123, { uuid: 'uuid-1' })
		const idx = createFileidIndex(store)

		expect(await idx.lookup(123)).toBe('uuid-1')
	})

	it('remember stores the mapping and round-trips through lookup', async () => {
		const store = makeFakeStore()
		const idx = createFileidIndex(store)

		await idx.remember(456, 'uuid-2')

		expect(store.set).toHaveBeenCalledWith(456, { uuid: 'uuid-2' })
		expect(await idx.lookup(456)).toBe('uuid-2')
	})

	it('forget removes the mapping', async () => {
		const store = makeFakeStore()
		store.data.set(123, { uuid: 'uuid-1' })
		const idx = createFileidIndex(store)

		await idx.forget(123)

		expect(store.delete).toHaveBeenCalledWith(123)
		expect(await idx.lookup(123)).toBeUndefined()
	})
})
