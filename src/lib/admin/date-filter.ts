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

/**
 * Keep only files whose `created` falls on `day` (local calendar day). When
 * `day` is undefined the list is returned unchanged. Files with a null/invalid
 * `created` are dropped while a filter is active.
 */
export function filterFilesByDay(
	files: ReadonlyArray<SourceFileItem>,
	day: string | undefined,
): SourceFileItem[] {
	if (!day) return [...files]
	return files.filter((f) => localDay(f.created) === day)
}

/** Local `YYYY-MM-DD` for today. */
export function todayLocal(): string {
	return formatLocalDay(new Date())
}

/** Local `YYYY-MM-DD` for tomorrow. */
export function tomorrowLocal(): string {
	const d = new Date()
	d.setDate(d.getDate() + 1)
	return formatLocalDay(d)
}
