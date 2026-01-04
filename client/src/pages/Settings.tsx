import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useAuthStore } from '../store/auth';

export default function Settings() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { walletAddress } = useAuthStore();

  const [scanInterval, setScanInterval] = useState('5000');
  const [minProfitUSD, setMinProfitUSD] = useState('0.01');
  const [maxDailyTrades, setMaxDailyTrades] = useState('100');

  const { data: statusData } = useQuery({
    queryKey: ['executor-status'],
    queryFn: () => api.get<{ data: { executor: any; risk: any } }>('/executor/status'),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (config: any) => api.patch('/executor/config', config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executor-status'] });
    },
  });

  const pauseTradingMutation = useMutation({
    mutationFn: () => api.post('/executor/risk/pause'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executor-status'] });
    },
  });

  const resumeTradingMutation = useMutation({
    mutationFn: () => api.post('/executor/risk/resume'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['executor-status'] });
    },
  });

  const handleSaveConfig = () => {
    updateConfigMutation.mutate({
      scanInterval: parseInt(scanInterval),
      minProfitUSD: parseFloat(minProfitUSD),
      maxDailyTrades: parseInt(maxDailyTrades),
    });
  };

  const riskStatus = statusData?.data?.risk;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Account Info */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Account</h2>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500">Connected Wallet</p>
            <p className="font-mono">{walletAddress}</p>
          </div>
        </div>
      </div>

      {/* Executor Config */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Executor Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Scan Interval (ms)</label>
            <input
              type="number"
              value={scanInterval}
              onChange={(e) => setScanInterval(e.target.value)}
              className="input"
              min="1000"
              max="60000"
            />
          </div>
          <div>
            <label className="label">Min Profit (USD)</label>
            <input
              type="number"
              value={minProfitUSD}
              onChange={(e) => setMinProfitUSD(e.target.value)}
              className="input"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="label">Max Daily Trades</label>
            <input
              type="number"
              value={maxDailyTrades}
              onChange={(e) => setMaxDailyTrades(e.target.value)}
              className="input"
              min="1"
              max="1000"
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={handleSaveConfig}
            disabled={updateConfigMutation.isPending}
            className="btn btn-primary"
          >
            {updateConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Risk Controls */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Risk Controls</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Trading Status</p>
            <p className={`text-lg font-semibold ${riskStatus?.tradingPaused ? 'text-red-600' : 'text-green-600'}`}>
              {riskStatus?.tradingPaused ? 'Paused' : 'Active'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Circuit Breaker</p>
            <p className={`text-lg font-semibold ${riskStatus?.circuitBreakerActive ? 'text-red-600' : 'text-green-600'}`}>
              {riskStatus?.circuitBreakerActive ? 'Triggered' : 'Normal'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Hourly Loss</p>
            <p className="text-lg font-semibold text-orange-600">
              ${riskStatus?.hourlyLoss?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Daily Loss</p>
            <p className="text-lg font-semibold text-orange-600">
              ${riskStatus?.dailyLoss?.toFixed(2) || '0.00'}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {riskStatus?.tradingPaused ? (
            <button
              onClick={() => resumeTradingMutation.mutate()}
              disabled={resumeTradingMutation.isPending}
              className="btn btn-primary"
            >
              Resume Trading
            </button>
          ) : (
            <button
              onClick={() => pauseTradingMutation.mutate()}
              disabled={pauseTradingMutation.isPending}
              className="btn btn-danger"
            >
              Emergency Pause
            </button>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card border-red-200">
        <h2 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h2>
        <p className="text-sm text-gray-600 mb-4">
          These actions are irreversible. Please be careful.
        </p>
        <div className="flex gap-2">
          <button className="btn btn-danger">
            Revoke All Delegations
          </button>
        </div>
      </div>
    </div>
  );
}
