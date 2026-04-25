// Indirection so tests can mock navigation; the real `window.location`
// interface is sealed in browsers and cannot be patched directly.
export function navigateTo(url: string) {
	window.location.assign(url)
}
