import { Wordmark } from '#/components/Wordmark'
import { useIdentity } from '#/lib/auth/identity-context'
import { Avatar, Box, Container, HStack, IconButton, Text, chakra } from '@chakra-ui/react'
import { Link as RouterLink, getRouteApi } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'

const route = getRouteApi('/')
const Link = chakra(RouterLink)

export function Topbar() {
	const { user, logout } = useIdentity()
	const { user: serverUser } = route.useRouteContext()
	const email = user?.email ?? serverUser.email ?? ''

	return (
		<Box
			as="header"
			position="sticky"
			top={0}
			zIndex="docked"
			bg="bg/80"
			backdropFilter="blur(14px) saturate(160%)"
			borderBottomWidth="1px"
			borderColor="line"
		>
			<Container maxW="1080px" px={{ base: 4, md: 4.5 }}>
				<HStack justify="space-between" align="center" gap={3} py={2.5}>
					<Link to="/" aria-label="Recuerdea" color="inherit" textDecoration="none">
						<Wordmark />
					</Link>
					<HStack gap={2.5}>
						<HStack
							borderWidth="1px"
							borderColor="line"
							borderRadius="full"
							pl="3px"
							pr={{ base: '3px', sm: 3 }}
							py="3px"
							gap={2}
							bg="paper/60"
						>
							<Avatar.Root size="xs" colorPalette="accent">
								<Avatar.Fallback name={email} />
							</Avatar.Root>
							<Text
								display={{ base: 'none', sm: 'inline' }}
								fontSize="sm"
								fontWeight={500}
								color="ink"
							>
								{email}
							</Text>
						</HStack>
						<IconButton
							variant="outline"
							size="sm"
							borderRadius="full"
							borderColor="line"
							color="ink.muted"
							bg="transparent"
							_hover={{ color: 'ink', borderColor: 'ink.muted', bg: 'paper/70' }}
							onClick={() => void logout()}
							aria-label="Cerrar sesión"
						>
							<LogOut size={14} aria-hidden />
						</IconButton>
					</HStack>
				</HStack>
			</Container>
		</Box>
	)
}
