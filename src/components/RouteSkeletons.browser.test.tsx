import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { render } from '../../test/test-utils'
import {
	AddSkeleton,
	CollectionListSkeleton,
	HomeSkeleton,
	MediaGridSkeleton,
	RoutePendingFallback,
} from './RouteSkeletons'

describe('RouteSkeletons', () => {
	it('MediaGridSkeleton renders the requested number of tiles', async () => {
		await render(<MediaGridSkeleton count={6} />)
		expect(page.getByTestId('skeleton-tile').elements()).toHaveLength(6)
	})

	it('AddSkeleton renders a media grid', async () => {
		await render(<AddSkeleton />)
		await expect.element(page.getByTestId('add-skeleton')).toBeVisible()
		expect(page.getByTestId('skeleton-tile').elements().length).toBeGreaterThan(0)
	})

	it('CollectionListSkeleton renders a media grid', async () => {
		await render(<CollectionListSkeleton />)
		await expect.element(page.getByTestId('collection-list-skeleton')).toBeVisible()
		expect(page.getByTestId('skeleton-tile').elements().length).toBeGreaterThan(0)
	})

	it('HomeSkeleton renders', async () => {
		await render(<HomeSkeleton />)
		await expect.element(page.getByTestId('home-skeleton')).toBeVisible()
	})

	it('RoutePendingFallback renders', async () => {
		await render(<RoutePendingFallback />)
		await expect.element(page.getByTestId('route-pending')).toBeVisible()
	})
})
