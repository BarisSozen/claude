import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useEffect, useState } from 'react';

interface ExecutorStatus {
  isRunning: boolean;
  dailyTradeCount: number;
  totalProfitToday: number;
  lastScanTime: string | null;
  config: {
    scanInterval: number;
    minProfitUSD: number;
    maxDailyTrades: number;
    enabledStrategies: string[];
  };
}

interface Metrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfitUSD: number;
  totalGasSpentUSD: number;
  uptime: number;
  successRate: number;
  netProfitUSD: number;
}

interface Opportunity {
  id: string;
  tokenPair: string;
  buyDex: string;
  sellDex: string;
  netProfitUSD: number;
  type: 'cross-exchange' | 'triangular' | 'cross-chain';
}

export default function Dashboard() {
  const api = useApi();
  const { subscribe, isConnected } = useWebSocket();
  const [liveStatus, setLiveStatus] = useState<ExecutorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/executor/status'],
    queryFn: () => api.get<{ data: { executor: ExecutorStatus; metrics: Metrics } }>('/executor/status'),
  });

  const { data: opportunitiesData } = useQuery({
    queryKey: ['/api/opportunities'],
    queryFn: () => api.get<{ data: { opportunities: Opportunity[]; count: number } }>('/opportunities'),
    refetchInterval: 10000,
  });

  useEffect(() => {
    const unsubscribe = subscribe('executor:status', (data) => {
      setLiveStatus(data as ExecutorStatus);
    });

    return unsubscribe;
  }, [subscribe]);

  const status = liveStatus || statusData?.data?.executor;
  const metrics = statusData?.data?.metrics;
  const opportunities = opportunitiesData?.data?.opportunities || [];

  const handleStartExecutor = async () => {
    try {
      setError(null);
      await api.post('/executor/start');
      refetchStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start executor';
      setError(message);
    }
  };

  const handleStopExecutor = async () => {
    try {
      setError(null);
      await api.post('/executor/stop');
      refetchStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop executor';
      setError(message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-600">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Error Toast */}
      {error && (
        <div
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex justify-between items-center"
          role="alert"
          data-testid="error-toast"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700 font-bold"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Executor Status */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Executor Status</h2>
          <div className="flex gap-2">
            {status?.isRunning ? (
              <button onClick={handleStopExecutor} className="btn btn-danger">
                Stop
              </button>
            ) : (
              <button onClick={handleStartExecutor} className="btn btn-primary">
                Start
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Status</p>
            <p className={`text-lg font-semibold ${status?.isRunning ? 'text-green-600' : 'text-gray-600'}`}>
              {status?.isRunning ? 'Running' : 'Stopped'}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Trades Today</p>
            <p className="text-lg font-semibold">{status?.dailyTradeCount || 0}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Profit Today</p>
            <p className="text-lg font-semibold text-green-600">
              ${(status?.totalProfitToday || 0).toFixed(4)}
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500">Last Scan</p>
            <p className="text-lg font-semibold">
              {status?.lastScanTime
                ? new Date(status.lastScanTime).toLocaleTimeString()
                : 'Never'}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Performance Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Total Trades</p>
              <p className="text-lg font-semibold">{metrics.totalTrades}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Success Rate</p>
              <p className="text-lg font-semibold">{metrics.successRate.toFixed(1)}%</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Net Profit</p>
              <p className={`text-lg font-semibold ${metrics.netProfitUSD >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${metrics.netProfitUSD.toFixed(4)}
              </p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Gas Spent</p>
              <p className="text-lg font-semibold text-orange-600">
                ${metrics.totalGasSpentUSD.toFixed(4)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Opportunities */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Active Opportunities</h2>
          <span className="text-sm text-gray-500">{opportunities.length} found</span>
        </div>

        {opportunities.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No active opportunities. The scanner will find them automatically.
          </p>
        ) : (
          <div className="space-y-3">
            {opportunities.slice(0, 5).map((opp) => (
              <div
                key={opp.id}
                data-testid={`opportunity-${opp.id}`}
                className="flex justify-between items-center p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="font-medium">{opp.tokenPair}</p>
                  <p className="text-sm text-gray-500">
                    {opp.buyDex} → {opp.sellDex}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-600">
                    +${opp.netProfitUSD.toFixed(4)}
                  </p>
                  <p className="text-sm text-gray-500">{opp.type}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
