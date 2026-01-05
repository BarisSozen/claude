import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useEffect, useState } from 'react';

interface Opportunity {
  id: string;
  type: 'cross-exchange' | 'triangular' | 'cross-chain';
  tokenPair: string;
  buyDex: string;
  sellDex: string;
  profitUSD: number;
  profitPercent: number;
  gasEstimateUSD: number;
  netProfitUSD: number;
  expiresAt: string;
}

export default function Opportunities() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();
  const [liveOpportunities, setLiveOpportunities] = useState<Opportunity[]>([]);

  const { data, isPending, refetch } = useQuery({
    queryKey: ['/api/opportunities'],
    queryFn: () => api.get<{ data: { opportunities: Opportunity[]; count: number } }>('/opportunities'),
    refetchInterval: 10000,
  });

  const scanMutation = useMutation({
    mutationFn: () => api.post('/opportunities/scan'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/opportunities'] });
    },
  });

  useEffect(() => {
    const unsubscribe = subscribe('opportunity:new', (data) => {
      setLiveOpportunities((prev) => [data as Opportunity, ...prev.slice(0, 9)]);
    });

    return unsubscribe;
  }, [subscribe]);

  const opportunities = data?.data?.opportunities || [];
  const allOpportunities = [...liveOpportunities, ...opportunities].slice(0, 20);

  const getTypeBadge = (type: Opportunity['type']) => {
    const styles: Record<Opportunity['type'], string> = {
      'cross-exchange': 'bg-blue-100 text-blue-800',
      'triangular': 'bg-purple-100 text-purple-800',
      'cross-chain': 'bg-orange-100 text-orange-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[type]}`}>
        {type}
      </span>
    );
  };

  const getExpiryStatus = (expiresAt: string) => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const secondsLeft = Math.floor((expiry.getTime() - now.getTime()) / 1000);

    if (secondsLeft <= 0) {
      return <span className="text-red-500">Expired</span>;
    }

    if (secondsLeft < 10) {
      return <span className="text-orange-500">{secondsLeft}s</span>;
    }

    return <span className="text-gray-500">{secondsLeft}s</span>;
  };

  if (isPending) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="btn btn-secondary"
          >
            Refresh
          </button>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="btn btn-primary"
          >
            {scanMutation.isPending ? 'Scanning...' : 'Manual Scan'}
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Active Opportunities</p>
          <p className="text-2xl font-bold">{allOpportunities.length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Best Profit</p>
          <p className="text-2xl font-bold text-green-600">
            ${allOpportunities[0]?.netProfitUSD?.toFixed(4) || '0.00'}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Total Potential</p>
          <p className="text-2xl font-bold text-green-600">
            ${allOpportunities.reduce((sum, o) => sum + o.netProfitUSD, 0).toFixed(4)}
          </p>
        </div>
      </div>

      {/* Opportunities List */}
      {allOpportunities.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-4">
            No active opportunities found. Click "Manual Scan" to search for arbitrage.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Pair</th>
                  <th className="pb-3 font-medium">Route</th>
                  <th className="pb-3 font-medium">Gross Profit</th>
                  <th className="pb-3 font-medium">Gas</th>
                  <th className="pb-3 font-medium">Net Profit</th>
                  <th className="pb-3 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {allOpportunities.map((opp) => (
                  <tr key={opp.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3">{getTypeBadge(opp.type)}</td>
                    <td className="py-3 font-medium">{opp.tokenPair}</td>
                    <td className="py-3 text-gray-600">
                      {opp.buyDex} → {opp.sellDex}
                    </td>
                    <td className="py-3 text-green-600">
                      ${opp.profitUSD.toFixed(4)}
                    </td>
                    <td className="py-3 text-orange-600">
                      -${opp.gasEstimateUSD.toFixed(4)}
                    </td>
                    <td className="py-3 font-semibold text-green-600">
                      ${opp.netProfitUSD.toFixed(4)}
                    </td>
                    <td className="py-3">{getExpiryStatus(opp.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
