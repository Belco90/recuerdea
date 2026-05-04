export function yearsAgo(n: number): string {
	if (n === 0) return 'hoy mismo'
	if (n === 1) return 'hace un año'
	return `hace ${n} años`
}

export function yearsAgoCapitalized(n: number): string {
	const text = yearsAgo(n)
	return text[0].toUpperCase() + text.slice(1)
}
