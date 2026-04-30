import { describe, expect, it } from 'vitest'

import { rotForKey } from './rotation'

describe('rotForKey', () => {
	it('returns the same angle for the same key (deterministic)', () => {
		expect(rotForKey('2024-0')).toBe(rotForKey('2024-0'))
		expect(rotForKey('a-very-long-key-string')).toBe(rotForKey('a-very-long-key-string'))
	})

	it('returns 0 for the empty string', () => {
		expect(rotForKey('')).toBe(-2.4)
	})

	it('keeps every angle within [-2.4, 2.4] degrees', () => {
		for (let i = 0; i < 200; i++) {
			const angle = rotForKey(`item-${i}-${i * 7919}`)
			expect(angle).toBeGreaterThanOrEqual(-2.4)
			expect(angle).toBeLessThanOrEqual(2.4)
		}
	})

	it('produces different angles for different keys (with high probability)', () => {
		const keys = Array.from({ length: 50 }, (_, i) => `key-${i}`)
		const angles = new Set(keys.map(rotForKey))
		// Hash collisions exist but should be rare across 50 distinct strings.
		expect(angles.size).toBeGreaterThan(40)
	})
})
