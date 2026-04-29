import { describe, expect, it } from 'vitest'

import { formatCaptureDate, todayIso } from './date'

describe('formatCaptureDate', () => {
	it('returns null when given null', () => {
		expect(formatCaptureDate(null)).toBeNull()
	})

	it('returns null when the ISO string is unparseable', () => {
		expect(formatCaptureDate('not-a-date')).toBeNull()
	})

	it('returns a formatted long-form date for a valid ISO string', () => {
		const result = formatCaptureDate('2024-03-15T10:30:00.000Z')
		expect(result).not.toBeNull()
		expect(result).toMatch(/2024/)
		expect(result).toMatch(/15/)
	})
})

describe('todayIso', () => {
	it('returns YYYY-MM-DD matching the current local date', () => {
		const iso = todayIso()
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)

		const now = new Date()
		const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
		expect(iso).toBe(expected)
	})
})
