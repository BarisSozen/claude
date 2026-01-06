import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Address } from 'viem';

interface AuthState {
  token: string | null;
  walletAddress: Address | null;
  userId: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, walletAddress: Address, userId: string) => void;
  logout: () => void;
}

/**
 * Secure storage implementation using sessionStorage
 * - sessionStorage is cleared when the browser tab/window closes
 * - Not accessible to other tabs (unlike localStorage)
 * - Still vulnerable to XSS, but limits the attack window
 *
 * For production, consider:
 * 1. Using httpOnly cookies for refresh tokens (server-side)
 * 2. Short-lived access tokens in memory only
 * 3. Token rotation on each request
 */
const secureStorage = createJSONStorage(() => sessionStorage);

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
      logout: () => {
        // Clear any cached data
        sessionStorage.removeItem('defi-bot-auth');
        set({
          token: null,
          walletAddress: null,
          userId: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'defi-bot-auth',
      storage: secureStorage,
      // Only persist non-sensitive data
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
        // Token stored in sessionStorage (not ideal but better than localStorage)
        // In production, use httpOnly cookies for tokens
        token: state.token,
      }),
    }
  )
);
