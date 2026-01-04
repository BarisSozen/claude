import { useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { SiweMessage } from 'siwe';
import { useAuthStore } from '../store/auth';

export default function ConnectWallet() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { setAuth, isAuthenticated } = useAuthStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Authenticate after wallet connection
  useEffect(() => {
    if (isConnected && address && !isAuthenticated) {
      authenticateWithSiwe(address);
    }
  }, [isConnected, address, isAuthenticated]);

  async function authenticateWithSiwe(walletAddress: string) {
    setIsAuthenticating(true);
    setError(null);

    try {
      // Get nonce from server
      const nonceRes = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });

      const nonceData = await nonceRes.json();

      if (!nonceData.success) {
        throw new Error(nonceData.error || 'Failed to get nonce');
      }

      // Create SIWE message
      const message = new SiweMessage({
        domain: window.location.host,
        address: walletAddress,
        statement: 'Sign in to DeFi Bot',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce: nonceData.data.nonce,
      });

      const messageToSign = message.prepareMessage();

      // Sign message
      const signature = await signMessageAsync({ message: messageToSign });

      // Verify with server
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageToSign,
          signature,
        }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Verification failed');
      }

      // Store auth state
      setAuth(
        verifyData.data.token,
        verifyData.data.user.walletAddress,
        verifyData.data.user.id
      );

      navigate('/');
    } catch (err) {
      console.error('Authentication error:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
      <div className="card max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🤖</div>
          <h1 className="text-2xl font-bold text-gray-900">DeFi Bot</h1>
          <p className="text-gray-600 mt-2">
            Non-custodial DeFi automation
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger-500/10 text-danger-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        {isAuthenticating ? (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-gray-600">Signing in...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => connect({ connector })}
                disabled={isPending}
                className="btn btn-secondary w-full flex items-center justify-center gap-2"
              >
                {connector.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            By connecting, you agree to our terms of service.
            Your funds stay in your wallet - we never have custody.
          </p>
        </div>
      </div>
    </div>
  );
}
