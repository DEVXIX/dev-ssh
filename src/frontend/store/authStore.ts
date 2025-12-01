import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  userId: number | null;
  username: string | null;
  isAuthenticated: boolean;
  login: (token: string, userId: number, username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userId: null,
      username: null,
      isAuthenticated: false,
      login: (token, userId, username) =>
        set({ token, userId, username, isAuthenticated: true }),
      logout: () =>
        set({ token: null, userId: null, username: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
