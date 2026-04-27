import { getServerUser } from '#/lib/auth'
import { useIdentity } from '#/lib/identity-context'
import { getFirstMemoryImage } from '#/lib/pcloud'
import { Box, Button, Heading, Image, Text } from '@chakra-ui/react'
import { createFileRoute, redirect } from '@tanstack/react-router'

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
	loader: async () => ({ memory: await getFirstMemoryImage() }),
	component: Home,
})

function Home() {
	const { user, logout } = useIdentity()
	const { memory } = Route.useLoaderData()

	return (
		<Box p={8}>
			<Heading size="2xl">Welcome back</Heading>
			<Text mt={4} fontSize="lg">
				Signed in as {user?.email}
			</Text>
			{memory ? (
				<Image mt={6} src={memory.url} alt={memory.name} maxW="md" />
			) : (
				<Text mt={6}>No memories yet.</Text>
			)}
			<Button mt={6} onClick={() => void logout()}>
				Sign out
			</Button>
		</Box>
	)
}
