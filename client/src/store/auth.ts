import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address } from 'viem';

interface AuthState {
  token: string | null;
  walletAddress: Address | null;
  userId: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, walletAddress: Address, userId: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      walletAddress: null,
      userId: null,
      isAuthenticated: false,
      setAuth: (token, walletAddress, userId) =>
        set({
          token,
          walletAddress,
          userId,
          isAuthenticated: true,
        }),
      logout: () =>
        set({
          token: null,
          walletAddress: null,
          userId: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'defi-bot-auth',
    }
  )
);
