import { vi } from 'vitest'

export const getCookie = vi.fn<(name: string) => string | undefined>()
