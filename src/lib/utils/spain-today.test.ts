import { describe, expect, it } from 'vitest'

import { getTodayInSpain, getTomorrowInSpain, spainMonthDay } from './spain-today'

describe('getTodayInSpain', () => {
	it('uses Europe/Madrid day when UTC is still previous day', () => {
		const result = getTodayInSpain(new Date('2026-05-15T22:30:00.000Z'))
		expect(result).toEqual({ month: 5, day: 16 })
	})

	it('matches same day when UTC and Europe/Madrid share calendar day', () => {
		const result = getTodayInSpain(new Date('2026-05-15T12:30:00.000Z'))
		expect(result).toEqual({ month: 5, day: 15 })
	})
})

describe('getTomorrowInSpain', () => {
	it('returns the next calendar day for a midday instant', () => {
		expect(getTomorrowInSpain(new Date('2026-05-15T12:30:00.000Z'))).toEqual({ month: 5, day: 16 })
	})

	it('rolls over the end of the month', () => {
		expect(getTomorrowInSpain(new Date('2026-01-31T12:00:00.000Z'))).toEqual({ month: 2, day: 1 })
	})

	it('rolls over the end of the year', () => {
		// Midday Dec 31 is Dec 31 in Madrid → tomorrow is Jan 1.
		expect(getTomorrowInSpain(new Date('2026-12-31T12:00:00.000Z'))).toEqual({ month: 1, day: 1 })
	})

	it('uses the Madrid day past midnight (late UTC rolls the year already)', () => {
		// 23:30Z on Dec 31 is already 00:30 Jan 1 in Madrid → tomorrow is Jan 2.
		expect(getTomorrowInSpain(new Date('2026-12-31T23:30:00.000Z'))).toEqual({ month: 1, day: 2 })
	})

	it('uses the Madrid calendar day when UTC is still the previous day', () => {
		// 22:30Z on May 15 is already May 16 in Madrid → tomorrow is May 17.
		expect(getTomorrowInSpain(new Date('2026-05-15T22:30:00.000Z'))).toEqual({ month: 5, day: 17 })
	})
})

describe('spainMonthDay', () => {
	it('derives month-day from an ISO instant in Madrid', () => {
		expect(spainMonthDay('2026-05-15T12:30:00.000Z')).toEqual({ month: 5, day: 15 })
	})

	it('uses the Madrid day for a late-UTC instant that rolls to the next day', () => {
		expect(spainMonthDay('2026-05-15T22:30:00.000Z')).toEqual({ month: 5, day: 16 })
	})

	it('returns null for null input', () => {
		expect(spainMonthDay(null)).toBeNull()
	})

	it('returns null for an unparseable instant', () => {
		expect(spainMonthDay('not-a-date')).toBeNull()
	})
})
