import { describe, expect, it } from 'vitest'

import type { MemoryItem } from './pcloud.server'

import { groupMemoriesByYear } from './memory-grouping'

function image(year: number, name: string): MemoryItem {
	return {
		kind: 'image',
		uuid: `uuid-${name}`,
		name,
		captureDate: `${year}-04-27T12:00:00.000Z`,
		width: null,
		height: null,
		place: null,
		thumbUrl: `https://thumb/${name}`,
		lightboxUrl: `https://lightbox/${name}`,
	}
}

const TODAY = { year: 2026, month: 4, day: 27 } as const

describe('groupMemoriesByYear', () => {
	it('returns an empty array for empty input', () => {
		expect(groupMemoriesByYear([], TODAY)).toEqual([])
	})

	it('groups a single item with yearsAgo = today.year - itemYear', () => {
		const item = image(2025, 'a.jpg')
		expect(groupMemoriesByYear([item], TODAY)).toEqual([{ year: 2025, yearsAgo: 1, items: [item] }])
	})

	it('groups items from different years and computes yearsAgo per group', () => {
		const items = [
			image(2018, 'a.jpg'),
			image(2018, 'b.jpg'),
			image(2024, 'c.jpg'),
			image(2025, 'd.jpg'),
		]
		const groups = groupMemoriesByYear(items, TODAY)

		expect(groups.map((g) => g.year)).toEqual([2018, 2024, 2025])
		expect(groups.map((g) => g.yearsAgo)).toEqual([8, 2, 1])
		expect(groups[0]!.items.map((i) => i.name)).toEqual(['a.jpg', 'b.jpg'])
		expect(groups[1]!.items.map((i) => i.name)).toEqual(['c.jpg'])
		expect(groups[2]!.items.map((i) => i.name)).toEqual(['d.jpg'])
	})

	it('preserves input order within a year', () => {
		const items = [image(2024, 'second.jpg'), image(2024, 'first.jpg')]
		const groups = groupMemoriesByYear(items, TODAY)

		expect(groups).toHaveLength(1)
		expect(groups[0]!.items.map((i) => i.name)).toEqual(['second.jpg', 'first.jpg'])
	})

	it('preserves caller-provided ordering across years', () => {
		// The loader returns items oldest-first; the helper must not re-sort.
		const items = [image(2024, 'a.jpg'), image(2018, 'b.jpg')]
		const groups = groupMemoriesByYear(items, TODAY)

		expect(groups.map((g) => g.year)).toEqual([2024, 2018])
	})

	it('skips items whose captureDate fails to parse', () => {
		const items: MemoryItem[] = [
			image(2024, 'a.jpg'),
			{
				kind: 'image',
				uuid: 'uuid-bad',
				name: 'bad.jpg',
				captureDate: 'not-a-date',
				width: null,
				height: null,
				place: null,
				thumbUrl: 'https://thumb/bad.jpg',
				lightboxUrl: 'https://lightbox/bad.jpg',
			},
		]
		const groups = groupMemoriesByYear(items, TODAY)

		expect(groups).toHaveLength(1)
		expect(groups[0]!.items.map((i) => i.name)).toEqual(['a.jpg'])
	})

	it('returns yearsAgo = 0 for items captured in the current year', () => {
		const item = image(2026, 'today.jpg')
		expect(groupMemoriesByYear([item], TODAY)).toEqual([{ year: 2026, yearsAgo: 0, items: [item] }])
	})
})
