import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { RoutePendingFallback } from './components/RouteSkeletons'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		defaultPreloadStaleTime: 0,
		// Show a skeleton once a loader has run longer than this, but keep it on
		// screen long enough to avoid a sub-perceptual flash on borderline loads.
		defaultPendingMs: 200,
		defaultPendingMinMs: 300,
		defaultPendingComponent: RoutePendingFallback,
	})

	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
