import { vi } from 'vitest'

export const acceptInvite = vi.fn<() => unknown>()
export const getUser = vi.fn<() => unknown>()
export const handleAuthCallback = vi.fn<() => unknown>()
export const login = vi.fn<() => unknown>()
export const logout = vi.fn<() => unknown>()
export const onAuthChange = vi.fn<() => unknown>()
export const updateUser = vi.fn<() => unknown>()
