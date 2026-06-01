export type MonthDay = { month: number; day: number }

const SPAIN_TIME_ZONE = 'Europe/Madrid'
const spainDayFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: SPAIN_TIME_ZONE,
	month: 'numeric',
	day: 'numeric',
})
const spainFullDateFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: SPAIN_TIME_ZONE,
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
})

function partsToNumber(
	parts: Intl.DateTimeFormatPart[],
	type: Intl.DateTimeFormatPartTypes,
): number {
	return Number(parts.find((part) => part.type === type)?.value)
}

// Read the month+day of an arbitrary instant in Europe/Madrid.
function monthDayInSpain(date: Date): MonthDay {
	const parts = spainDayFormatter.formatToParts(date)
	const month = partsToNumber(parts, 'month')
	const day = partsToNumber(parts, 'day')
	if (!Number.isInteger(month) || !Number.isInteger(day)) {
		throw new Error(`failed to resolve month-day in timezone ${SPAIN_TIME_ZONE}`)
	}
	return { month, day }
}

export function getTodayInSpain(now: Date = new Date()): MonthDay {
	return monthDayInSpain(now)
}

/**
 * Month-day for "tomorrow" in Europe/Madrid, with month/year rollover handled.
 * Uses calendar (date-component) arithmetic — read Madrid's full Y-M-D for
 * `now`, advance one day in UTC, re-read month/day — so it stays correct across
 * DST transitions and month/year boundaries (no wall-clock `+24h`).
 */
export function getTomorrowInSpain(now: Date = new Date()): MonthDay {
	const parts = spainFullDateFormatter.formatToParts(now)
	const year = partsToNumber(parts, 'year')
	const month = partsToNumber(parts, 'month')
	const day = partsToNumber(parts, 'day')
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		throw new Error(`failed to resolve tomorrow in timezone ${SPAIN_TIME_ZONE}`)
	}
	// UTC noon avoids any DST edge; advancing the date component rolls over
	// month/year via the Date constructor's normalization.
	const next = new Date(Date.UTC(year, month - 1, day + 1, 12))
	return { month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

/**
 * ISO instant → `{month, day}` in Europe/Madrid, or null for null/invalid
 * input. Used to match a file's `created` against a Spain day target.
 */
export function spainMonthDay(iso: string | null): MonthDay | null {
	if (iso === null) return null
	const ms = Date.parse(iso)
	if (Number.isNaN(ms)) return null
	return monthDayInSpain(new Date(ms))
}
