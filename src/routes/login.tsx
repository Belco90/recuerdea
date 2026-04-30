import type { SubmitEventHandler } from 'react'

import { AppShell } from '#/components/AppShell'
import { Wordmark } from '#/components/Wordmark'
import { getServerUser } from '#/lib/auth'
import { spanishMonth } from '#/lib/spanish-months'
import { Box, Button, Field, Heading, Input, Link, Stack, Text, VStack } from '@chakra-ui/react'
import { acceptInvite, handleAuthCallback, login, updateUser } from '@netlify/identity'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/login')({
	beforeLoad: async () => {
		// If a callback hash is present, skip the redirect check. The component
		// handles invite/recovery flows that land on this page while logged in.
		if (
			typeof window !== 'undefined' &&
			/[#&](invite_token|recovery_token|access_token|error)=/.test(window.location.hash)
		) {
			return
		}
		const user = await getServerUser()
		if (user) throw redirect({ to: '/' })
	},
	component: LoginPage,
})

type Mode = 'login' | 'invite' | 'recovery'

const TITLES: Record<Mode, string> = {
	login: 'Entrar',
	invite: 'Aceptar invitación',
	recovery: 'Establecer contraseña',
}

const PASSWORD_LABELS: Record<Mode, string> = {
	login: 'Contraseña',
	invite: 'Elige una contraseña',
	recovery: 'Elige una contraseña',
}

const HEADINGS: Record<Mode, { title: string; sub: (day: number, month: string) => string }> = {
	login: {
		title: 'Hoy te espera\nalgo del pasado.',
		sub: (day, month) => `Entra para ver lo que pasó un ${day} de ${month} en años anteriores.`,
	},
	invite: {
		title: 'Bienvenido a\nRecuerdea.',
		sub: () => 'Elige una contraseña para terminar de configurar tu cuenta.',
	},
	recovery: {
		title: 'Renueva tu\ncontraseña.',
		sub: () => 'Elige una contraseña nueva para volver a entrar.',
	},
}

function LoginPage() {
	const [mode, setMode] = useState<Mode>('login')
	const [inviteToken, setInviteToken] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	useEffect(() => {
		void handleAuthCallback().then((result) => {
			if (!result) return
			if (result.type === 'invite' && result.token) {
				setInviteToken(result.token)
				setMode('invite')
			} else if (result.type === 'recovery') {
				setMode('recovery')
			} else if (result.user) {
				window.location.href = '/'
			}
		})
	}, [])

	const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
		e.preventDefault()
		const data = new FormData(e.currentTarget)
		const email = data.get('email') as string
		const password = data.get('password') as string
		setError(null)
		setLoading(true)

		try {
			if (mode === 'login') {
				if (!email || !password) {
					setError('Introduce tu correo y contraseña.')
					return
				}
				await login(email, password)
			} else if (mode === 'invite') {
				await acceptInvite(inviteToken, password)
			} else {
				await updateUser({ password })
			}
			window.location.href = '/'
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Algo ha ido mal.')
		} finally {
			setLoading(false)
		}
	}

	const today = new Date()
	const day = today.getDate()
	const month = spanishMonth(today.getMonth())
	const heading = HEADINGS[mode]

	return (
		<AppShell>
			<VStack
				minH="100vh"
				justify="center"
				align="center"
				gap={7}
				px={6}
				py={10}
				position="relative"
				overflow="hidden"
			>
				<DecorativePolaroids />

				<Box
					position="relative"
					zIndex={1}
					w="full"
					maxW="400px"
					bg="paper"
					borderWidth="1px"
					borderColor="line"
					borderRadius="4px"
					px={{ base: 8, md: 9 }}
					pt={{ base: 9, md: 9 }}
					pb={{ base: 8, md: 8 }}
					boxShadow="rdShadowLift"
				>
					<Box mb={6} color="ink">
						<Wordmark size="lg" />
					</Box>
					<Heading
						as="h1"
						fontFamily="heading"
						fontWeight={400}
						fontStyle="italic"
						fontSize="30px"
						lineHeight="1.1"
						letterSpacing="-0.02em"
						color="ink"
						whiteSpace="pre-line"
					>
						{heading.title}
					</Heading>
					<Text mt={2.5} mb={5.5} color="ink.muted" fontSize="14px" lineHeight="1.55">
						{heading.sub(day, month)}
					</Text>

					<form onSubmit={handleSubmit} noValidate>
						<Stack gap={3.5}>
							{mode === 'login' && (
								<Field.Root>
									<Field.Label
										fontFamily="mono"
										fontSize="11px"
										fontWeight={600}
										color="ink.muted"
										letterSpacing="0.1em"
										textTransform="uppercase"
										mb={1.5}
									>
										Correo
									</Field.Label>
									<Input
										type="email"
										name="email"
										autoComplete="email"
										placeholder="tu@familia.es"
										h="42px"
										bg="bg"
										color="ink"
										borderColor="line"
										borderRadius="4px"
										fontSize="14.5px"
										_focus={{
											borderColor: 'accent.500',
											bg: 'paper',
											boxShadow: '0 0 0 3px var(--chakra-colors-accent-200)',
										}}
									/>
								</Field.Root>
							)}

							<Field.Root>
								<Field.Label
									fontFamily="mono"
									fontSize="11px"
									fontWeight={600}
									color="ink.muted"
									letterSpacing="0.1em"
									textTransform="uppercase"
									mb={1.5}
								>
									{PASSWORD_LABELS[mode]}
								</Field.Label>
								<Input
									type="password"
									name="password"
									required
									autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
									placeholder="••••••••"
									h="42px"
									bg="bg"
									color="ink"
									borderColor="line"
									borderRadius="4px"
									fontSize="14.5px"
									_focus={{
										borderColor: 'accent.500',
										bg: 'paper',
										boxShadow: '0 0 0 3px var(--chakra-colors-accent-200)',
									}}
								/>
							</Field.Root>

							{error && (
								<Text fontSize="13px" color="red.600" _dark={{ color: 'orange.300' }}>
									{error}
								</Text>
							)}

							<Button
								type="submit"
								loading={loading}
								h="44px"
								mt={1.5}
								borderRadius="4px"
								bg="ink"
								color="paper"
								fontSize="14.5px"
								fontWeight={500}
								letterSpacing="0.02em"
								_hover={{ bg: 'accent.700' }}
								_active={{ transform: 'scale(0.99)' }}
							>
								{TITLES[mode]}
							</Button>

							{mode === 'login' && (
								<Link
									href="#"
									textAlign="center"
									mt={1}
									color="ink.muted"
									fontSize="13px"
									_hover={{ color: 'accent.500', textDecoration: 'none' }}
								>
									¿Olvidaste tu contraseña?
								</Link>
							)}
						</Stack>
					</form>
				</Box>

				<Text
					position="relative"
					zIndex={1}
					fontFamily="heading"
					fontStyle="italic"
					fontSize="14px"
					color="ink.muted"
					textAlign="center"
				>
					Un pequeño ritual diario para tu familia.
				</Text>
			</VStack>
		</AppShell>
	)
}

const STRIPE_PATTERN =
	'repeating-linear-gradient(38deg, var(--chakra-colors-bg-muted) 0 8px, var(--chakra-colors-accent-soft) 8px 16px)'

function DecorativePolaroids() {
	return (
		<Box
			position="absolute"
			inset={0}
			pointerEvents="none"
			display="flex"
			justifyContent="center"
			alignItems="center"
			aria-hidden
		>
			<DecorativePolaroid transform="rotate(-12deg)" top="8%" left="-40px" opacity={0.6} />
			<DecorativePolaroid transform="rotate(8deg)" bottom="10%" right="-30px" opacity={0.6} />
			<DecorativePolaroid
				transform="rotate(-5deg)"
				top="14%"
				right="10%"
				opacity={0.35}
				display={{ base: 'none', sm: 'block' }}
			/>
		</Box>
	)
}

function DecorativePolaroid(props: {
	transform: string
	top?: string
	bottom?: string
	left?: string
	right?: string
	opacity?: number
	display?: object
}) {
	return (
		<Box
			position="absolute"
			w="140px"
			h="165px"
			bg="paper"
			borderRadius="2px"
			boxShadow="rdShadowLift"
			_before={{
				content: '""',
				position: 'absolute',
				inset: '7px 7px 28px 7px',
				bgImage: STRIPE_PATTERN,
				opacity: 0.8,
			}}
			{...props}
		/>
	)
}
