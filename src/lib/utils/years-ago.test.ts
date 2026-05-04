import { describe, expect, it } from 'vitest'

import { yearsAgo, yearsAgoCapitalized } from './years-ago'

describe('yearsAgo', () => {
	it('returns "hoy mismo" for the current year', () => {
		expect(yearsAgo(0)).toBe('hoy mismo')
	})

	it('returns "hace un año" for one year ago (singular)', () => {
		expect(yearsAgo(1)).toBe('hace un año')
	})

	it('returns "hace N años" for N years ago (plural)', () => {
		expect(yearsAgo(2)).toBe('hace 2 años')
		expect(yearsAgo(10)).toBe('hace 10 años')
	})
})

describe('yearsAgoCapitalized', () => {
	it('capitalizes the first letter for each variant', () => {
		expect(yearsAgoCapitalized(0)).toBe('Hoy mismo')
		expect(yearsAgoCapitalized(1)).toBe('Hace un año')
		expect(yearsAgoCapitalized(7)).toBe('Hace 7 años')
	})
})
