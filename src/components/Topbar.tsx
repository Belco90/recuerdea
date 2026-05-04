import { Wordmark } from '#/components/Wordmark'
import { useIdentity } from '#/lib/auth/identity-context'
import {
	Box,
	Button,
	Container,
	Drawer,
	HStack,
	IconButton,
	Portal,
	Stack,
	Text,
	chakra,
} from '@chakra-ui/react'
import { ClientOnly, Link as RouterLink } from '@tanstack/react-router'
import { LogOut, User, X } from 'lucide-react'

const Link = chakra(RouterLink)

export function Topbar() {
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
					<ClientOnly>
						<AccountDrawer />
					</ClientOnly>
				</HStack>
			</Container>
		</Box>
	)
}

function AccountDrawer() {
	const { user, logout } = useIdentity()

	return (
		<Drawer.Root placement="end" size="xs">
			<Drawer.Trigger asChild>
				<IconButton
					aria-label="Abrir menú de cuenta"
					size="sm"
					borderRadius="full"
					variant="outline"
					borderColor="line"
					color="ink.muted"
					bg="transparent"
					_hover={{ color: 'ink', borderColor: 'ink.muted', bg: 'paper/70' }}
				>
					<User size={16} aria-hidden />
				</IconButton>
			</Drawer.Trigger>
			<Portal>
				<Drawer.Backdrop />
				<Drawer.Positioner>
					<Drawer.Content bg="paper" borderLeftWidth="1px" borderColor="line">
						<Drawer.Header borderBottomWidth="1px" borderColor="line">
							<Drawer.Title color="ink">Cuenta</Drawer.Title>
							<Drawer.CloseTrigger asChild>
								<IconButton variant="ghost" size="sm" aria-label="Cerrar">
									<X size={18} aria-hidden />
								</IconButton>
							</Drawer.CloseTrigger>
						</Drawer.Header>
						<Drawer.Body>
							<Stack gap={3}>
								<Box>
									<Text fontSize="xs" color="ink.muted">
										Nombre
									</Text>
									<Text color="ink">{user?.name ?? '—'}</Text>
								</Box>
								<Box>
									<Text fontSize="xs" color="ink.muted">
										Correo
									</Text>
									<Text color="ink">{user?.email ?? '—'}</Text>
								</Box>
							</Stack>
						</Drawer.Body>
						<Drawer.Footer borderTopWidth="1px" borderColor="line">
							<Button onClick={() => void logout()} variant="outline" w="full">
								<LogOut size={14} aria-hidden /> Cerrar sesión
							</Button>
						</Drawer.Footer>
					</Drawer.Content>
				</Drawer.Positioner>
			</Portal>
		</Drawer.Root>
	)
}
