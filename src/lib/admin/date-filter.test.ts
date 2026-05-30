import type { SourceFileItem } from '#/lib/admin/source-folder.server'

import { describe, expect, it } from 'vitest'

import { filterFilesByDay, localDay, localMonthDay, todayLocal, tomorrowLocal } from './date-filter'

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

describe('localMonthDay', () => {
	it('returns the local MM-DD for a valid instant', () => {
		expect(localMonthDay(localNoonIso(2023, 5, 30))).toBe('05-30')
	})

	it('returns null for null/invalid input', () => {
		expect(localMonthDay(null)).toBeNull()
		expect(localMonthDay('not a date')).toBeNull()
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

	it('keeps only files on the given month+day', () => {
		expect(filterFilesByDay(files, '2024-04-15').map((f) => f.fileid)).toEqual([1])
	})

	it('matches by month+day across years (the on-this-day regression)', () => {
		// Three photos from 2023-05-30; filtering by today (a 2026-05-30) must
		// surface them even though the years differ.
		const may30 = [
			file(10, localNoonIso(2023, 5, 30)),
			file(11, localNoonIso(2023, 5, 30)),
			file(12, localNoonIso(2023, 5, 30)),
			file(13, localNoonIso(2022, 5, 31)),
		]
		expect(filterFilesByDay(may30, '2026-05-30').map((f) => f.fileid)).toEqual([10, 11, 12])
	})

	it('drops files with a null created when a day is active', () => {
		expect(filterFilesByDay(files, '2030-04-16').map((f) => f.fileid)).toEqual([2])
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
