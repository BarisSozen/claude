/**
 * Create Delegation Form Component
 * Full form for creating session key delegations with all restriction options
 */

import { useState, useMemo } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { parseUnits } from 'viem';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import {
  generateSessionKey,
  encryptSessionKey,
  getEncryptionSignatureMessage,
} from '../utils/crypto';
import {
  CHAINS,
  PROTOCOLS,
  getProtocolsForChain,
  getTokensForChain,
  type ChainId,
} from '../constants/protocols';

interface CreateDelegationFormProps {
  onClose: () => void;
  onSuccess?: () => void;
}

type Step = 'configure' | 'review' | 'signing' | 'complete';

export default function CreateDelegationForm({
  onClose,
  onSuccess,
}: CreateDelegationFormProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const api = useApi();
  const queryClient = useQueryClient();

  // Form state
  const [step, setStep] = useState<Step>('configure');
  const [error, setError] = useState<string | null>(null);

  // Configuration
  const [chainId, setChainId] = useState<ChainId>('ethereum');
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [validityDays, setValidityDays] = useState('30');
  const [customValidity, setCustomValidity] = useState('');
  const [isCustomValidity, setIsCustomValidity] = useState(false);

  // Limits
  const [maxPerTrade, setMaxPerTrade] = useState('1000');
  const [maxDailyVolume, setMaxDailyVolume] = useState('10000');
  const [maxWeeklyVolume, setMaxWeeklyVolume] = useState('50000');
  const [maxLeverage, setMaxLeverage] = useState('1.0');

  // Generated session key
  const [sessionKey, setSessionKey] = useState<{
    privateKey: `0x${string}`;
    address: `0x${string}`;
  } | null>(null);

  // Available options based on selected chain
  const availableProtocols = useMemo(
    () => getProtocolsForChain(chainId),
    [chainId]
  );
  const availableTokens = useMemo(() => getTokensForChain(chainId), [chainId]);

  // Reset selections when chain changes
  const handleChainChange = (newChain: ChainId) => {
    setChainId(newChain);
    setSelectedProtocols([]);
    setSelectedTokens([]);
  };

  // Toggle protocol selection
  const toggleProtocol = (protocolId: string) => {
    setSelectedProtocols((prev) =>
      prev.includes(protocolId)
        ? prev.filter((p) => p !== protocolId)
        : [...prev, protocolId]
    );
  };

  // Toggle token selection
  const toggleToken = (tokenAddress: string) => {
    setSelectedTokens((prev) =>
      prev.includes(tokenAddress)
        ? prev.filter((t) => t !== tokenAddress)
        : [...prev, tokenAddress]
    );
  };

  // Select all protocols
  const selectAllProtocols = () => {
    setSelectedProtocols(availableProtocols.map((p) => p.id));
  };

  // Select all tokens
  const selectAllTokens = () => {
    setSelectedTokens(availableTokens.map((t) => t.address));
  };

  // Validation
  const isValid =
    selectedProtocols.length > 0 &&
    selectedTokens.length > 0 &&
    parseFloat(maxPerTrade) > 0 &&
    parseFloat(maxDailyVolume) > 0 &&
    parseFloat(maxWeeklyVolume) > 0 &&
    parseFloat(maxLeverage) >= 1;

  // Create delegation mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      encryptedSessionKey: string;
      sessionKeyAddress: string;
    }) => {
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + parseInt(validityDays));

      return api.post('/delegations', {
        walletAddress: address,
        sessionKeyAddress: data.sessionKeyAddress,
        encryptedSessionKey: data.encryptedSessionKey,
        chainId,
        allowedProtocols: selectedProtocols,
        allowedTokens: selectedTokens,
        validUntil: validUntil.toISOString(),
        limits: {
          maxPerTrade: parseUnits(maxPerTrade, 6).toString(), // USD with 6 decimals
          maxDailyVolume: parseUnits(maxDailyVolume, 6).toString(),
          maxWeeklyVolume: parseUnits(maxWeeklyVolume, 6).toString(),
          maxLeverage,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegations'] });
      setStep('complete');
      onSuccess?.();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create delegation');
      setStep('configure');
    },
  });

  // Handle form submission
  const handleSubmit = async () => {
    if (!address || !isValid) return;

    setError(null);
    setStep('signing');

    try {
      // Step 1: Generate session key
      const newSessionKey = generateSessionKey();
      setSessionKey(newSessionKey);

      // Step 2: Get encryption signature from user
      const message = getEncryptionSignatureMessage(address);
      const signature = await signMessageAsync({ message });

      // Step 3: Encrypt the session key
      const encryptedKey = await encryptSessionKey(
        newSessionKey.privateKey,
        signature
      );

      // Step 4: Send to server
      await createMutation.mutateAsync({
        encryptedSessionKey: encryptedKey,
        sessionKeyAddress: newSessionKey.address,
      });
    } catch (err) {
      console.error('Delegation creation failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to create delegation');
      setStep('configure');
    }
  };

  // Render configure step
  const renderConfigureStep = () => (
    <div className="space-y-6">
      {/* Chain Selection */}
      <div>
        <label className="label">Blockchain Network</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {CHAINS.map((chain) => (
            <button
              key={chain.id}
              type="button"
              onClick={() => handleChainChange(chain.id)}
              className={`p-3 rounded-lg border-2 transition-colors ${
                chainId === chain.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium">{chain.name}</div>
              <div className="text-xs text-gray-500">{chain.icon}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Protocol Selection */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="label">Allowed Protocols (DEXes)</label>
          <button
            type="button"
            onClick={selectAllProtocols}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Select All
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {availableProtocols.map((protocol) => (
            <button
              key={protocol.id}
              type="button"
              onClick={() => toggleProtocol(protocol.id)}
              className={`p-3 rounded-lg border-2 text-left transition-colors ${
                selectedProtocols.includes(protocol.id)
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-sm">{protocol.name}</div>
              <div className="text-xs text-gray-500 capitalize">
                {protocol.type}
              </div>
            </button>
          ))}
        </div>
        {selectedProtocols.length === 0 && (
          <p className="text-sm text-red-500 mt-1">
            Select at least one protocol
          </p>
        )}
      </div>

      {/* Token Selection */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="label">Allowed Tokens</label>
          <button
            type="button"
            onClick={selectAllTokens}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Select All
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {availableTokens.map((token) => (
            <button
              key={token.address}
              type="button"
              onClick={() => toggleToken(token.address)}
              className={`p-3 rounded-lg border-2 text-left transition-colors ${
                selectedTokens.includes(token.address)
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="font-medium text-sm">{token.symbol}</div>
              <div className="text-xs text-gray-500 truncate">{token.name}</div>
            </button>
          ))}
        </div>
        {selectedTokens.length === 0 && (
          <p className="text-sm text-red-500 mt-1">Select at least one token</p>
        )}
      </div>

      {/* Trading Limits */}
      <div>
        <label className="label">Trading Limits (USD)</label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-600">Max Per Trade</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                type="number"
                value={maxPerTrade}
                onChange={(e) => setMaxPerTrade(e.target.value)}
                className="input pl-7"
                min="1"
                step="100"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-600">Max Daily Volume</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                type="number"
                value={maxDailyVolume}
                onChange={(e) => setMaxDailyVolume(e.target.value)}
                className="input pl-7"
                min="1"
                step="1000"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-600">Max Weekly Volume</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                type="number"
                value={maxWeeklyVolume}
                onChange={(e) => setMaxWeeklyVolume(e.target.value)}
                className="input pl-7"
                min="1"
                step="5000"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Leverage Limit */}
      <div>
        <label className="label">Maximum Leverage</label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={maxLeverage}
            onChange={(e) => setMaxLeverage(e.target.value)}
            className="flex-1"
          />
          <span className="text-lg font-semibold w-16 text-center">
            {maxLeverage}x
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          1x = No leverage (spot trading only)
        </p>
      </div>

      {/* Validity Period */}
      <div>
        <label className="label">Validity Period</label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { value: '30', label: '30 days' },
            { value: '180', label: '180 days' },
            { value: '365', label: '1 year' },
            { value: 'custom', label: 'Custom' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                if (option.value === 'custom') {
                  setIsCustomValidity(true);
                  setValidityDays(customValidity || '30');
                } else {
                  setIsCustomValidity(false);
                  setValidityDays(option.value);
                }
              }}
              className={`p-3 rounded-lg border-2 transition-colors ${
                (option.value === 'custom' && isCustomValidity) ||
                (option.value !== 'custom' && !isCustomValidity && validityDays === option.value)
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {isCustomValidity && (
          <div className="mt-3">
            <label className="text-sm text-gray-600">Custom duration (days)</label>
            <input
              type="number"
              value={customValidity}
              onChange={(e) => {
                setCustomValidity(e.target.value);
                setValidityDays(e.target.value);
              }}
              placeholder="Enter number of days"
              className="input mt-1"
              min="1"
              max="730"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum 730 days (2 years)
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => setStep('review')}
          disabled={!isValid}
          className="btn btn-primary"
        >
          Review Delegation
        </button>
      </div>
    </div>
  );

  // Render review step
  const renderReviewStep = () => (
    <div className="space-y-6">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-yellow-800">
          Please review your delegation settings carefully. Once created, some
          settings cannot be changed.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Network</span>
          <span className="font-medium capitalize">{chainId}</span>
        </div>

        <div className="py-2 border-b">
          <span className="text-gray-600">Allowed Protocols</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {selectedProtocols.map((p) => (
              <span
                key={p}
                className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm"
              >
                {PROTOCOLS.find((pr) => pr.id === p)?.name || p}
              </span>
            ))}
          </div>
        </div>

        <div className="py-2 border-b">
          <span className="text-gray-600">Allowed Tokens</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {selectedTokens.map((t) => (
              <span
                key={t}
                className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm"
              >
                {availableTokens.find((tk) => tk.address === t)?.symbol || t.slice(0, 8)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Max Per Trade</span>
          <span className="font-medium">${maxPerTrade}</span>
        </div>

        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Max Daily Volume</span>
          <span className="font-medium">${maxDailyVolume}</span>
        </div>

        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Max Weekly Volume</span>
          <span className="font-medium">${maxWeeklyVolume}</span>
        </div>

        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Max Leverage</span>
          <span className="font-medium">{maxLeverage}x</span>
        </div>

        <div className="flex justify-between py-2 border-b">
          <span className="text-gray-600">Valid For</span>
          <span className="font-medium">{validityDays} days</span>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <button
          type="button"
          onClick={() => setStep('configure')}
          className="btn btn-secondary"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="btn btn-primary"
        >
          Create Delegation
        </button>
      </div>
    </div>
  );

  // Render signing step
  const renderSigningStep = () => (
    <div className="text-center py-12">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
      <h3 className="text-lg font-semibold mb-2">Creating Delegation</h3>
      <p className="text-gray-600">
        Please sign the message in your wallet to encrypt your session key...
      </p>
    </div>
  );

  // Render complete step
  const renderCompleteStep = () => (
    <div className="text-center py-12">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <svg
          className="w-8 h-8 text-green-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-2">Delegation Created!</h3>
      <p className="text-gray-600 mb-2">
        Your session key has been generated and encrypted.
      </p>
      {sessionKey && (
        <p className="text-sm font-mono text-gray-500 mb-6">
          Session Key: {sessionKey.address.slice(0, 10)}...
          {sessionKey.address.slice(-8)}
        </p>
      )}
      <button type="button" onClick={onClose} className="btn btn-primary">
        Done
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Create Delegation</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Step indicator */}
          {step !== 'complete' && (
            <div className="flex items-center gap-2 mt-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === 'configure'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                1
              </div>
              <div className="flex-1 h-1 bg-gray-200">
                <div
                  className={`h-full bg-blue-600 transition-all ${
                    step === 'configure' ? 'w-0' : 'w-full'
                  }`}
                />
              </div>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === 'review' || step === 'signing'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                2
              </div>
            </div>
          )}
        </div>

        <div className="p-6">
          {step === 'configure' && renderConfigureStep()}
          {step === 'review' && renderReviewStep()}
          {step === 'signing' && renderSigningStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>
      </div>
    </div>
  );
}
