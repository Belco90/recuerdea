import { describe, expect, it } from 'vitest'

import { getTodayInSpain } from './spain-today'

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
