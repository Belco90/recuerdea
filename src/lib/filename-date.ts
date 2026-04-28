// Some pCloud files have the capture date encoded in the filename
// (screenshots, "Save to Files", several camera apps). When EXIF/mvhd
// extraction fails — notably for HEIC, where exifr's Node support is
// unreliable and EXIF lives at arbitrary offsets in `mdat` — this is
// the next-best signal we have.
//
// Recognised shapes (anchored to the start of the name):
//   YYYY-MM-DD HH-MM-SS.ext      — e.g., "2026-04-17 17-16-08.heic"
//   YYYY-MM-DD_HH-MM-SS.ext      — underscore separator
//   YYYY-MM-DD.ext               — date only
//
// Time defaults to 00:00:00. The Date is constructed in local time so
// that month/day matching aligns with the user's calendar day.

const FILENAME_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ _](\d{2})-(\d{2})-(\d{2}))?/

export function parseFilenameCaptureDate(name: string): Date | null {
	const match = FILENAME_DATE_PATTERN.exec(name)
	if (!match) return null

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const hour = match[4] ? Number(match[4]) : 0
	const minute = match[5] ? Number(match[5]) : 0
	const second = match[6] ? Number(match[6]) : 0

	if (month < 1 || month > 12) return null
	if (day < 1 || day > 31) return null
	if (hour > 23 || minute > 59 || second > 59) return null

	const date = new Date(year, month - 1, day, hour, minute, second)
	// Reject coerced dates like Feb 30 → Mar 2.
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
		return null
	}
	return date
}
