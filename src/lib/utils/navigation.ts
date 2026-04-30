// Forces a full page reload instead of TanStack Router's soft navigate(),
// so the browser sends updated auth cookies on the next request.
export function hardNavigate(url: string) {
	window.location.href = url
}
