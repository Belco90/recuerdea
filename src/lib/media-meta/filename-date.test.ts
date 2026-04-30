import { describe, expect, it } from 'vitest'

import { parseFilenameCaptureDate } from './filename-date'

describe('parseFilenameCaptureDate', () => {
	it('parses YYYY-MM-DD HH-MM-SS with space separator', () => {
		const result = parseFilenameCaptureDate('2026-04-17 17-16-08.heic')
		expect(result).not.toBeNull()
		expect(result?.getFullYear()).toBe(2026)
		expect(result?.getMonth()).toBe(3)
		expect(result?.getDate()).toBe(17)
		expect(result?.getHours()).toBe(17)
		expect(result?.getMinutes()).toBe(16)
		expect(result?.getSeconds()).toBe(8)
	})

	it('parses YYYY-MM-DD_HH-MM-SS with underscore separator', () => {
		const result = parseFilenameCaptureDate('2026-04-17_17-16-08.heic')
		expect(result?.getFullYear()).toBe(2026)
		expect(result?.getMonth()).toBe(3)
		expect(result?.getDate()).toBe(17)
		expect(result?.getHours()).toBe(17)
	})

	it('parses date-only YYYY-MM-DD with default time', () => {
		const result = parseFilenameCaptureDate('2026-04-17.jpg')
		expect(result?.getFullYear()).toBe(2026)
		expect(result?.getMonth()).toBe(3)
		expect(result?.getDate()).toBe(17)
		expect(result?.getHours()).toBe(0)
		expect(result?.getMinutes()).toBe(0)
		expect(result?.getSeconds()).toBe(0)
	})

	it('returns null for filenames without a date prefix', () => {
		expect(parseFilenameCaptureDate('IMG_4567.HEIC')).toBeNull()
		expect(parseFilenameCaptureDate('vacation.png')).toBeNull()
		expect(parseFilenameCaptureDate('photo (1).jpg')).toBeNull()
	})

	it('returns null for an invalid month', () => {
		expect(parseFilenameCaptureDate('2026-13-01.jpg')).toBeNull()
		expect(parseFilenameCaptureDate('2026-00-01.jpg')).toBeNull()
	})

	it('returns null when day-of-month is invalid for the month (Feb 30)', () => {
		expect(parseFilenameCaptureDate('2026-02-30.jpg')).toBeNull()
	})

	it('returns null for out-of-range time components', () => {
		expect(parseFilenameCaptureDate('2026-04-17 25-00-00.jpg')).toBeNull()
		expect(parseFilenameCaptureDate('2026-04-17 12-60-00.jpg')).toBeNull()
		expect(parseFilenameCaptureDate('2026-04-17 12-00-60.jpg')).toBeNull()
	})

	it('returns null for an empty string', () => {
		expect(parseFilenameCaptureDate('')).toBeNull()
	})
})
