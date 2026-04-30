export const SPANISH_MONTHS = [
	'enero',
	'febrero',
	'marzo',
	'abril',
	'mayo',
	'junio',
	'julio',
	'agosto',
	'septiembre',
	'octubre',
	'noviembre',
	'diciembre',
] as const

export function spanishMonth(monthIndex: number): string {
	return SPANISH_MONTHS[monthIndex] ?? ''
}
