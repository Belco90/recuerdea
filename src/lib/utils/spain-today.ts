export type MonthDay = { month: number; day: number }

const SPAIN_TIME_ZONE = 'Europe/Madrid'
const spainDayFormatter = new Intl.DateTimeFormat('en-US', {
	timeZone: SPAIN_TIME_ZONE,
	month: 'numeric',
	day: 'numeric',
})

export function getTodayInSpain(now: Date = new Date()): MonthDay {
	const parts = spainDayFormatter.formatToParts(now)
	const month = Number(parts.find((part) => part.type === 'month')?.value)
	const day = Number(parts.find((part) => part.type === 'day')?.value)
	if (!Number.isInteger(month) || !Number.isInteger(day)) {
		throw new Error(`failed to resolve today in timezone ${SPAIN_TIME_ZONE}`)
	}
	return { month, day }
}
