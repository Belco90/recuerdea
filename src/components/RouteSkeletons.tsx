import {
	Box,
	Container,
	HStack,
	SimpleGrid,
	Skeleton,
	SkeletonCircle,
	Stack,
} from '@chakra-ui/react'

/**
 * Loading-state placeholders shaped roughly like each slow route, shown via
 * the route's `pendingComponent` while its loader runs (see tasks/plan.md).
 * All pure presentational — no router/auth coupling — so they render in
 * isolation and stay cheap.
 */

/** Square media tiles laid out like the real admin/collection grids. */
export function MediaGridSkeleton({ count = 8 }: { count?: number }) {
	return (
		<SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} gap={3} data-testid="media-grid-skeleton">
			{Array.from({ length: count }, (_, i) => (
				<Skeleton key={i} aspectRatio="square" borderRadius="md" data-testid="skeleton-tile" />
			))}
		</SimpleGrid>
	)
}

/** Lightweight stand-in for the sticky Topbar (kept auth-context free). */
function HeaderStripSkeleton() {
	return (
		<Box
			borderBottomWidth="1px"
			borderColor="line"
			bg="bg/80"
			position="sticky"
			top={0}
			zIndex="docked"
		>
			<Container maxW="1080px" px={{ base: 4, md: 4.5 }}>
				<HStack justify="space-between" align="center" py={2.5}>
					<Skeleton h="20px" w="120px" />
					<SkeletonCircle size="8" />
				</HStack>
			</Container>
		</Box>
	)
}

/**
 * Inner content of `/admin/collection/add` (the layout + heading are already
 * rendered around the Outlet, so this omits the page chrome).
 */
export function AddSkeleton() {
	return (
		<Stack gap={4} data-testid="add-skeleton">
			<Skeleton h="18px" w="90px" />
			<Skeleton h="26px" w="140px" />
			<HStack gap={2}>
				<Skeleton h="32px" w="70px" borderRadius="md" />
				<Skeleton h="32px" w="80px" borderRadius="md" />
				<Skeleton h="32px" w="90px" borderRadius="md" />
			</HStack>
			<MediaGridSkeleton count={8} />
		</Stack>
	)
}

/** Full-page placeholder for the `/admin/collection` layout loader. */
export function CollectionListSkeleton() {
	return (
		<Box minH="100vh" color="ink" data-testid="collection-list-skeleton">
			<HeaderStripSkeleton />
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				<Stack gap={6}>
					<Stack gap={2}>
						<Skeleton h="34px" w="260px" />
						<Skeleton h="16px" w="320px" />
					</Stack>
					<Skeleton h="44px" w="full" borderRadius="md" />
					<Skeleton h="24px" w="180px" />
					<MediaGridSkeleton count={8} />
				</Stack>
			</Container>
		</Box>
	)
}

/** Full-page placeholder for the home timeline loader. */
export function HomeSkeleton() {
	return (
		<Box minH="100vh" color="ink" data-testid="home-skeleton">
			<HeaderStripSkeleton />
			<Container as="main" maxW="1080px" px={{ base: 4, md: 4.5 }} pt={8} pb={20}>
				<Stack gap={3} mb={10} align="center" textAlign="center">
					<Skeleton h="44px" w={{ base: '260px', md: '420px' }} />
					<Skeleton h="18px" w="200px" />
				</Stack>
				<Skeleton h="22px" w="80px" mb={5} />
				<SimpleGrid columns={{ base: 2, md: 3 }} gap={6}>
					{Array.from({ length: 6 }, (_, i) => (
						<Skeleton key={i} h={{ base: '200px', md: '260px' }} borderRadius="sm" />
					))}
				</SimpleGrid>
			</Container>
		</Box>
	)
}

/** Generic fallback for any route without a bespoke skeleton. */
export function RoutePendingFallback() {
	return (
		<Container maxW="1080px" px={{ base: 4, md: 4.5 }} py={16} data-testid="route-pending">
			<Stack gap={4} align="center">
				<Skeleton h="28px" w="220px" />
				<Skeleton h="16px" w="300px" />
				<Skeleton h="16px" w="260px" />
			</Stack>
		</Container>
	)
}
