import { vi } from 'vitest'

export const getUser = vi.fn<() => unknown>()
export const logout = vi.fn<() => unknown>()
export const onAuthChange = vi.fn<() => unknown>()
