import { create } from 'zustand'
import type { Notification } from '@/api'

interface NotificationsState {
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  // A single freshly-arrived notification held here so the <Toaster />
  // component can observe it. Set to null once the toast has been shown.
  latest: Notification | null

  setAll: (notifications: Notification[], unreadCount: number) => void
  prepend: (notification: Notification) => void
  markRead: (ids: string[]) => void
  markAllRead: () => void
  clearLatest: () => void
  setLoading: (loading: boolean) => void
}

export const useNotificationsStore = create<NotificationsState>()((set) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  latest: null,

  setAll: (notifications, unreadCount) => set({ notifications, unreadCount }),

  prepend: (notification) =>
    set((state) => {
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state
      }
      return {
        notifications: [notification, ...state.notifications],
        unreadCount: state.unreadCount + (notification.readAt ? 0 : 1),
        latest: notification,
      }
    }),

  markRead: (ids) =>
    set((state) => {
      const idSet = new Set(ids)
      let removed = 0
      const next = state.notifications.filter((n) => {
        if (idSet.has(n.id)) {
          if (!n.readAt) removed++
          return false
        }
        return true
      })
      return {
        notifications: next,
        unreadCount: Math.max(0, state.unreadCount - removed),
      }
    }),

  markAllRead: () => set({ notifications: [], unreadCount: 0 }),

  clearLatest: () => set({ latest: null }),
  setLoading: (isLoading) => set({ isLoading }),
}))
