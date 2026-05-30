import { todayLocal, tomorrowLocal } from '#/lib/admin/date-filter'
import { Button, DatePicker, HStack, Input, Portal, Text, parseDate } from '@chakra-ui/react'
import { CalendarIcon } from 'lucide-react'

type AdminMediaDateFilterProps = {
	/** Active day as `YYYY-MM-DD`, or undefined when no filter is applied. */
	value: string | undefined
	onChange: (date: string | undefined) => void
}

// Date filter for the picker media grid. Two relative presets (Hoy / Mañana)
// plus a calendar for any single day. Purely presentational — the parent owns
// the URL search-param state, so this stays trivially testable.
export function AdminMediaDateFilter({ value, onChange }: AdminMediaDateFilterProps) {
	const today = todayLocal()
	const tomorrow = tomorrowLocal()

	return (
		<HStack gap="2" flexWrap="wrap" align="center">
			<Text fontSize="sm" color="ink.muted" fontFamily="mono">
				Fecha:
			</Text>

			<Button
				size="xs"
				colorPalette="accent"
				variant={value === today ? 'solid' : 'outline'}
				onClick={() => onChange(value === today ? undefined : today)}
			>
				Hoy
			</Button>
			<Button
				size="xs"
				colorPalette="accent"
				variant={value === tomorrow ? 'solid' : 'outline'}
				onClick={() => onChange(value === tomorrow ? undefined : tomorrow)}
			>
				Mañana
			</Button>

			<DatePicker.Root
				maxW="12rem"
				size="xs"
				selectionMode="single"
				startOfWeek={1}
				locale="es-ES"
				value={value ? [parseDate(value)] : []}
				onValueChange={({ value: picked }) => {
					const next = picked[0]
					onChange(next ? next.toString() : undefined)
				}}
			>
				<DatePicker.Control>
					<DatePicker.Input asChild>
						<Input
							bg="paper"
							color="ink"
							fontFamily="mono"
							borderColor="accent.300"
							placeholder="Cualquier fecha"
							_focus={{
								borderColor: 'accent.500',
								boxShadow: '0 0 0 3px var(--chakra-colors-accent-200)',
							}}
						/>
					</DatePicker.Input>
					<DatePicker.IndicatorGroup>
						<DatePicker.Context>
							{(context) => (context.value.length ? <DatePicker.ClearTrigger /> : null)}
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
	)
}
