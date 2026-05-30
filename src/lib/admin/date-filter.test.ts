import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { describe, expect, it } from 'vitest'

import { filterFilesByDay, localDay, todayLocal, tomorrowLocal } from './date-filter'

function file(fileid: number, created: string | null): SourceFileItem {
	return { fileid, name: `f-${fileid}.jpg`, kind: 'image', thumbUrl: '', created }
}

// Build an ISO instant that lands on a known local day regardless of the test
// machine's timezone: noon local time is the same calendar day everywhere.
function localNoonIso(year: number, month: number, day: number): string {
	return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

describe('localDay', () => {
	it('returns the local YYYY-MM-DD for a valid instant', () => {
		expect(localDay(localNoonIso(2024, 4, 15))).toBe('2024-04-15')
	})

	it('returns null for null input', () => {
		expect(localDay(null)).toBeNull()
	})

	it('returns null for an unparseable string', () => {
		expect(localDay('not a date')).toBeNull()
	})
})

describe('filterFilesByDay', () => {
	const files = [
		file(1, localNoonIso(2024, 4, 15)),
		file(2, localNoonIso(2024, 4, 16)),
		file(3, null),
	]

	it('returns the list unchanged when no day is given', () => {
		expect(filterFilesByDay(files, undefined).map((f) => f.fileid)).toEqual([1, 2, 3])
	})

	it('keeps only files on the given day', () => {
		expect(filterFilesByDay(files, '2024-04-15').map((f) => f.fileid)).toEqual([1])
	})

	it('drops files with a null created when a day is active', () => {
		expect(filterFilesByDay(files, '2024-04-16').map((f) => f.fileid)).toEqual([2])
	})

	it('returns empty when nothing matches', () => {
		expect(filterFilesByDay(files, '2024-04-17')).toEqual([])
	})
})

describe('todayLocal / tomorrowLocal', () => {
	it('produce YYYY-MM-DD strings exactly one day apart', () => {
		const today = todayLocal()
		const tomorrow = tomorrowLocal()
		expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		expect(tomorrow).toMatch(/^\d{4}-\d{2}-\d{2}$/)
		const diffMs = Date.parse(`${tomorrow}T00:00:00`) - Date.parse(`${today}T00:00:00`)
		expect(diffMs).toBe(24 * 60 * 60 * 1000)
	})
})
