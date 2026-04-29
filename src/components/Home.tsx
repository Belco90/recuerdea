import type { MemoryItem } from '#/lib/pcloud.server'

import { AdminDateOverride } from '#/components/AdminDateOverride'
import { formatCaptureDate, MemoryView } from '#/components/MemoryView'
import { useIdentity } from '#/lib/identity-context'
import { Box, Button, Heading, Stack, Text } from '@chakra-ui/react'
import { getRouteApi } from '@tanstack/react-router'

const route = getRouteApi('/')

function memoryKey(item: MemoryItem): string {
	return item.uuid
}

export function Home() {
	const { user, logout } = useIdentity()
	const { memories } = route.useLoaderData()
	const { date: activeDate } = route.useSearch()

	const isAdmin = user?.role === 'admin' || (user?.roles?.includes('admin') ?? false)

	const emptyMessage = activeDate
		? `No memories for ${formatCaptureDate(activeDate)}.`
		: 'No memories on this day.'

	return (
		<Box p={8}>
			<Heading size="2xl">Welcome back</Heading>
			<Text mt={4} fontSize="lg">
				Signed in as {user?.email}
			</Text>

			{isAdmin && <AdminDateOverride activeDate={activeDate} />}

			{memories.length === 0 ? (
				<Text mt={6} fontSize="md">
					{emptyMessage}
				</Text>
			) : (
				<Stack mt={6} gap={8}>
					{memories.map((item) => (
						<MemoryView key={memoryKey(item)} item={item} />
					))}
				</Stack>
			)}

			<Button mt={6} onClick={() => void logout()}>
				Sign out
			</Button>
		</Box>
	)
}
