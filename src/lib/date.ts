const captureDateFormatter = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'long',
	day: 'numeric',
})

export function formatCaptureDate(iso: string | null): string | null {
	if (!iso) return null
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	return captureDateFormatter.format(date)
}

export function todayIso(): string {
	const now = new Date()
	const yyyy = now.getFullYear()
	const mm = String(now.getMonth() + 1).padStart(2, '0')
	const dd = String(now.getDate()).padStart(2, '0')
	return `${yyyy}-${mm}-${dd}`
}
