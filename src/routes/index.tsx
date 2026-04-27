import type { MemoryImage } from '#/lib/pcloud.server'

import { getServerUser } from '#/lib/auth'
import { useIdentity } from '#/lib/identity-context'
import { getRandomMemoryImage, getTodayMemoryImage } from '#/lib/pcloud'
import { Box, Button, Heading, Image, Stack, Text } from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'

const captureDateFormatter = new Intl.DateTimeFormat(undefined, {
	year: 'numeric',
	month: 'long',
	day: 'numeric',
})

export const Route = createFileRoute('/')({
	beforeLoad: async ({ location }) => {
		const user = await getServerUser()
		if (!user) {
			throw redirect({
				to: '/login',
				search: { redirect: location.href },
			})
		}
	},
	loader: async () => ({ memory: await getTodayMemoryImage() }),
	component: Home,
})

function formatCaptureDate(iso: string | null): string | null {
	if (!iso) return null
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	return captureDateFormatter.format(date)
}

function MemoryView({ memory, caption }: { memory: MemoryImage; caption: string }) {
	const formatted = formatCaptureDate(memory.captureDate)
	return (
		<Stack mt={6} gap={2}>
			<Text fontSize="md" color="gray.600">
				{caption}
			</Text>
			<Image src={memory.url} alt={memory.name} maxW="md" />
			{formatted && <Text fontSize="sm">Taken {formatted}</Text>}
		</Stack>
	)
}

function Home() {
	const { user, logout } = useIdentity()
	const { memory } = Route.useLoaderData()
	const [randomMemory, setRandomMemory] = useState<MemoryImage | null>(null)
	const [isLoadingRandom, setIsLoadingRandom] = useState(false)

	async function handleShowRandom() {
		setIsLoadingRandom(true)
		try {
			setRandomMemory(await getRandomMemoryImage())
		} finally {
			setIsLoadingRandom(false)
		}
	}

	return (
		<Box p={8}>
			<Heading size="2xl">Welcome back</Heading>
			<Text mt={4} fontSize="lg">
				Signed in as {user?.email}
			</Text>

			{memory ? (
				<MemoryView memory={memory} caption="On this day" />
			) : randomMemory ? (
				<MemoryView memory={randomMemory} caption="A random memory" />
			) : (
				<Stack mt={6} gap={3}>
					<Text fontSize="md">No memories on this day.</Text>
					<Button alignSelf="flex-start" onClick={handleShowRandom} loading={isLoadingRandom}>
						Show me a random memory
					</Button>
				</Stack>
			)}

			{randomMemory && (
				<Button mt={4} variant="outline" onClick={handleShowRandom} loading={isLoadingRandom}>
					Show another random memory
				</Button>
			)}

			<Button mt={6} onClick={() => void logout()}>
				Sign out
			</Button>
		</Box>
	)
}
