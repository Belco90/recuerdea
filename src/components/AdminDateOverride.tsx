import { todayIso } from '#/lib/date'
import {
	Button,
	DatePicker,
	Flex,
	IconButton,
	Input,
	parseDate,
	Portal,
	Stack,
	Text,
} from '@chakra-ui/react'
import { getRouteApi } from '@tanstack/react-router'
import { Calendar } from 'lucide-react'

const route = getRouteApi('/')

export function AdminDateOverride({ activeDate }: { activeDate: string | undefined }) {
	const navigate = route.useNavigate()
	const value = activeDate ?? todayIso()

	return (
		<Stack mt={6} gap={2} maxW="sm">
			<Text fontSize="sm" color="gray.600">
				Admin: preview "today's memories" for any date
			</Text>
			<Flex gap={2} align="center">
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
							<Input size="sm" />
						</DatePicker.Input>
						<DatePicker.Trigger asChild>
							<IconButton size="sm" variant="outline" aria-label="Open calendar">
								<Calendar size={16} />
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
														<IconButton size="xs" variant="ghost" aria-label="Previous month">
															‹
														</IconButton>
													</DatePicker.PrevTrigger>
													<DatePicker.ViewTrigger asChild>
														<Button size="xs" variant="ghost">
															<DatePicker.RangeText />
														</Button>
													</DatePicker.ViewTrigger>
													<DatePicker.NextTrigger asChild>
														<IconButton size="xs" variant="ghost" aria-label="Next month">
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
				{activeDate && (
					<Button size="sm" variant="ghost" onClick={() => void navigate({ search: {} })}>
						Reset to today
					</Button>
				)}
			</Flex>
		</Stack>
	)
}
