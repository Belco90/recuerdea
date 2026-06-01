import type { SourceFileItem } from '#/lib/admin/source-folder.server'

// Date-filtering helpers for the pCloud collection picker. Filtering is done in
// the browser against each file's `created` instant, compared by *local*
// calendar day so "today"/"tomorrow" mean the admin's today/tomorrow.

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n)
}

function formatLocalDay(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** ISO instant → local `YYYY-MM-DD`, or null for null/invalid input. */
export function localDay(iso: string | null): string | null {
	if (iso === null) return null
	const ms = Date.parse(iso)
	if (Number.isNaN(ms)) return null
	return formatLocalDay(new Date(ms))
}

/** ISO instant → local `MM-DD`, or null for null/invalid input. */
export function localMonthDay(iso: string | null): string | null {
	const day = localDay(iso)
	return day === null ? null : day.slice(5)
}

/**
 * Keep only files whose `created` shares the **month and day** of `day`,
 * ignoring the year — the same "on this day" rule the home loader uses
 * (`src/lib/memories/pcloud.server.ts`). `day` is a full `YYYY-MM-DD` but only
 * its `MM-DD` portion matters. When `day` is undefined the list is returned
 * unchanged. Files with a null/invalid `created` are dropped while active.
 */
export function filterFilesByDay(
	files: ReadonlyArray<SourceFileItem>,
	day: string | undefined,
): SourceFileItem[] {
	if (!day) return [...files]
	const monthDay = day.slice(5)
	return files.filter((f) => localMonthDay(f.created) === monthDay)
}
