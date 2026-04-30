// Stable per-key rotation in [-2.4°, 2.4°]. Used to scatter polaroid tiles
// without flicker on re-render: identical keys always return identical angles.
export function rotForKey(key: string): number {
	let h = 0
	for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
	const positive = h < 0 ? -h : h
	return ((positive % 1000) / 1000 - 0.5) * 4.8
}
