export function createServerFn(_opts?: unknown) {
	return {
		handler<T>(fn: T): T {
			return fn
		},
	}
}
