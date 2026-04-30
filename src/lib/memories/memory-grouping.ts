import type { MemoryItem } from './pcloud.server'

export type YearGroup = {
	readonly year: number
	readonly yearsAgo: number
	readonly items: readonly MemoryItem[]
}

export function groupMemoriesByYear(
	items: readonly MemoryItem[],
	today: { year: number; month: number; day: number },
): readonly YearGroup[] {
	// Map preserves insertion order — caller's ordering across years carries
	// into the output. The loader sorts oldest year first; we don't re-sort.
	const groups = new Map<number, MemoryItem[]>()
	for (const item of items) {
		const date = new Date(item.captureDate)
		if (Number.isNaN(date.getTime())) continue
		const year = date.getFullYear()
		const list = groups.get(year)
		if (list) list.push(item)
		else groups.set(year, [item])
	}
	return Array.from(groups, ([year, list]) => ({
		year,
		yearsAgo: today.year - year,
		items: list,
	}))
}
