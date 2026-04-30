import { Badge, Box, DatePicker, HStack, Input, parseDate, Portal } from '@chakra-ui/react'
import { getRouteApi } from '@tanstack/react-router'
import { CalendarIcon, Star } from 'lucide-react'

const route = getRouteApi('/')

const STRIPE_BG = `repeating-linear-gradient(-45deg,
  color-mix(in srgb, var(--chakra-colors-accent-500) 10%, var(--chakra-colors-bg)) 0 14px,
  color-mix(in srgb, var(--chakra-colors-accent-500) 4%, var(--chakra-colors-bg)) 14px 28px)`

export function AdminDateOverride({
	initialActiveDate,
}: {
	initialActiveDate: string | undefined
}) {
	const navigate = route.useNavigate()

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
			<HStack
				mx="auto"
				px={{ base: '2', md: '4' }}
				py="2"
				gap="2"
				flexWrap="wrap"
				justify="space-between"
				align="center"
			>
				<Badge size="sm" variant="solid" bg="accent.500" fontFamily="mono">
					<Star size={10} fill="currentColor" aria-hidden />
					Solo admin
				</Badge>

				<HStack gap="2" flexWrap="wrap" align="center">
					<DatePicker.Root
						maxW="12rem"
						size={{ base: 'xs', md: 'lg' }}
						selectionMode="single"
						startOfWeek={1}
						locale="es-ES"
						defaultValue={initialActiveDate ? [parseDate(initialActiveDate)] : undefined}
						onValueChange={({ value: picked }) => {
							const next = picked[0]
							if (!next) {
								void navigate({ search: {} })
								return
							}
							void navigate({ search: { date: next.toString() } })
						}}
					>
						<DatePicker.Control>
							<DatePicker.Input asChild>
								<Input
									bg="paper"
									color="ink"
									fontFamily="mono"
									borderColor="accent.300"
									_focus={{
										borderColor: 'accent.500',
										boxShadow: '0 0 0 3px var(--chakra-colors-accent-200)',
									}}
								/>
							</DatePicker.Input>
							<DatePicker.IndicatorGroup>
								<DatePicker.Context>
									{(context) => {
										return context.value.length ? <DatePicker.ClearTrigger /> : null
									}}
								</DatePicker.Context>
								<DatePicker.Trigger>
									<CalendarIcon aria-hidden />
								</DatePicker.Trigger>
							</DatePicker.IndicatorGroup>
						</DatePicker.Control>

						<Portal>
							<DatePicker.Positioner>
								<DatePicker.Content bg="paper">
									<DatePicker.View view="day">
										<DatePicker.Header />
										<DatePicker.DayTable />
									</DatePicker.View>
									<DatePicker.View view="month">
										<DatePicker.Header />
										<DatePicker.MonthTable />
									</DatePicker.View>
									<DatePicker.View view="year">
										<DatePicker.Header />
										<DatePicker.YearTable />
									</DatePicker.View>
								</DatePicker.Content>
							</DatePicker.Positioner>
						</Portal>
					</DatePicker.Root>
				</HStack>
			</HStack>
		</Box>
	)
}
