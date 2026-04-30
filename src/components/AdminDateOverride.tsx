import { todayIso } from '#/lib/date'
import { spanishMonth } from '#/lib/spanish-months'
import {
	Box,
	Button,
	DatePicker,
	HStack,
	IconButton,
	Input,
	Portal,
	Stack,
	Text,
	parseDate,
} from '@chakra-ui/react'
import { getRouteApi } from '@tanstack/react-router'
import { Star } from 'lucide-react'

const route = getRouteApi('/')

const STRIPE_BG = `repeating-linear-gradient(-45deg,
  color-mix(in srgb, var(--chakra-colors-accent-500) 10%, var(--chakra-colors-bg)) 0 14px,
  color-mix(in srgb, var(--chakra-colors-accent-500) 4%, var(--chakra-colors-bg)) 14px 28px)`

export function AdminDateOverride({ activeDate }: { activeDate: string | undefined }) {
	const navigate = route.useNavigate()
	const value = activeDate ?? todayIso()
	const isOverridden = !!activeDate
	const overrideParts = activeDate ? activeDate.split('-').map(Number) : null
	const overrideDay = overrideParts ? overrideParts[2] : null
	const overrideMonth = overrideParts ? spanishMonth((overrideParts[1] ?? 1) - 1) : null

	return (
		<Box
			as="section"
			role="region"
			aria-label="Controles de administración"
			position="relative"
			bgImage={STRIPE_BG}
			borderBottomWidth="1px"
			borderBottomStyle="dashed"
			borderBottomColor="accent.300"
		>
			<Box
				position="absolute"
				left="50%"
				top="-7px"
				w="110px"
				h="16px"
				bg="accent.100"
				transform="translateX(-50%) rotate(-1deg)"
				opacity={0.85}
				boxShadow="0 1px 2px rgba(0,0,0,.08)"
				borderLeftWidth="1px"
				borderLeftStyle="dashed"
				borderLeftColor="blackAlpha.100"
				borderRightWidth="1px"
				borderRightStyle="dashed"
				borderRightColor="blackAlpha.100"
				aria-hidden
			/>
			<HStack
				maxW="1080px"
				mx="auto"
				px={4.5}
				py={3.5}
				gap={4.5}
				flexWrap="wrap"
				justify="space-between"
				align="center"
			>
				<HStack gap={2.5} flexWrap="wrap" flex={1} minW={0}>
					<HStack
						as="span"
						bg="accent.500"
						color="paper"
						borderRadius="3px"
						px={2.25}
						py={1}
						fontFamily="mono"
						fontSize="10.5px"
						fontWeight={700}
						letterSpacing="0.12em"
						textTransform="uppercase"
						gap={1.25}
						flexShrink={0}
					>
						<Star size={10} fill="currentColor" aria-hidden />
						<Box as="span">Solo admin</Box>
					</HStack>
					<Text
						fontFamily="heading"
						fontStyle="italic"
						fontSize="16px"
						fontWeight={500}
						color="ink"
					>
						Sobreescribir fecha de hoy
					</Text>
					<Text
						display={{ base: 'none', md: 'inline' }}
						fontSize="12.5px"
						color="ink.muted"
						fontStyle="italic"
					>
						Para pruebas — cambia qué día se considera «hoy».
					</Text>
				</HStack>

				<HStack gap={2.5} flexWrap="wrap" align="center">
					<DatePicker.Root
						selectionMode="single"
						startOfWeek={1}
						value={[parseDate(value)]}
						onValueChange={({ value: picked }) => {
							const next = picked[0]
							if (!next) return
							void navigate({ search: { date: next.toString() } })
						}}
					>
						<DatePicker.Control>
							<DatePicker.Input asChild>
								<Input
									size="sm"
									h="34px"
									w="auto"
									minW="120px"
									bg="paper"
									color="ink"
									fontFamily="mono"
									fontSize="12.5px"
									borderColor="accent.300"
									borderRadius="4px"
									_focus={{
										borderColor: 'accent.500',
										boxShadow: '0 0 0 3px var(--chakra-colors-accent-200)',
									}}
								/>
							</DatePicker.Input>
							<DatePicker.Trigger asChild>
								<IconButton
									size="sm"
									variant="outline"
									aria-label="Abrir calendario"
									borderColor="accent.300"
								>
									<Star size={14} aria-hidden />
								</IconButton>
							</DatePicker.Trigger>
						</DatePicker.Control>
						<Portal>
							<DatePicker.Positioner>
								<DatePicker.Content>
									<DatePicker.View view="day">
										<DatePicker.Context>
											{(api) => (
												<Stack gap={2}>
													<DatePicker.ViewControl>
														<DatePicker.PrevTrigger asChild>
															<IconButton size="xs" variant="ghost" aria-label="Mes anterior">
																‹
															</IconButton>
														</DatePicker.PrevTrigger>
														<DatePicker.ViewTrigger asChild>
															<Button size="xs" variant="ghost">
																<DatePicker.RangeText />
															</Button>
														</DatePicker.ViewTrigger>
														<DatePicker.NextTrigger asChild>
															<IconButton size="xs" variant="ghost" aria-label="Mes siguiente">
																›
															</IconButton>
														</DatePicker.NextTrigger>
													</DatePicker.ViewControl>
													<DatePicker.Table>
														<DatePicker.TableHead>
															<DatePicker.TableRow>
																{api.weekDays.map((day) => (
																	<DatePicker.TableHeader key={day.short}>
																		{day.narrow}
																	</DatePicker.TableHeader>
																))}
															</DatePicker.TableRow>
														</DatePicker.TableHead>
														<DatePicker.TableBody>
															{api.weeks.map((week) => (
																<DatePicker.TableRow key={week[0].toString()}>
																	{week.map((day) => (
																		<DatePicker.TableCell key={day.toString()} value={day}>
																			<DatePicker.TableCellTrigger>
																				{day.day}
																			</DatePicker.TableCellTrigger>
																		</DatePicker.TableCell>
																	))}
																</DatePicker.TableRow>
															))}
														</DatePicker.TableBody>
													</DatePicker.Table>
												</Stack>
											)}
										</DatePicker.Context>
									</DatePicker.View>
								</DatePicker.Content>
							</DatePicker.Positioner>
						</Portal>
					</DatePicker.Root>

					{isOverridden && (
						<Button
							size="sm"
							variant="outline"
							h="34px"
							borderColor="line"
							color="ink.muted"
							fontFamily="mono"
							fontSize="11.5px"
							letterSpacing="0.06em"
							textTransform="uppercase"
							_hover={{ color: 'ink', borderColor: 'ink.muted' }}
							onClick={() => void navigate({ search: {} })}
						>
							Restablecer
						</Button>
					)}

					<HStack
						gap={1.5}
						fontFamily="mono"
						fontSize="11px"
						letterSpacing="0.08em"
						textTransform="uppercase"
						color={isOverridden ? 'accent.500' : 'ink.muted'}
					>
						<Box
							w="7px"
							h="7px"
							borderRadius="full"
							bg="currentColor"
							boxShadow={
								isOverridden
									? '0 0 0 3px color-mix(in srgb, var(--chakra-colors-accent-500) 25%, transparent)'
									: undefined
							}
							animation={isOverridden ? 'rdPulse 1.6s ease-in-out infinite' : undefined}
							aria-hidden
						/>
						<Box as="span">
							{isOverridden && overrideDay && overrideMonth
								? `Simulando ${overrideDay} de ${overrideMonth}`
								: 'Fecha real'}
						</Box>
					</HStack>
				</HStack>
			</HStack>
		</Box>
	)
}
