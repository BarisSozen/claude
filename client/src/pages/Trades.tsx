import { useQuery } from '@tanstack/react-query';
import { useApi } from '../hooks/useApi';
import { formatDistanceToNow } from 'date-fns';

interface Trade {
  id: string;
  delegationId: string;
  txHash: string | null;
  chainId: string;
  protocol: string;
  action: 'swap' | 'lend' | 'borrow' | 'repay' | 'flash_loan';
  tokenIn: string | null;
  tokenOut: string | null;
  amountIn: string;
  amountOut: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  profitUsd: string | null;
  status: 'pending' | 'success' | 'failed' | 'reverted';
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export default function Trades() {
  const api = useApi();

  const { data, isPending } = useQuery({
    queryKey: ['/api/trades/history'],
    queryFn: () => api.get<{ data: { trades: Trade[] } }>('/trades/history'),
    refetchInterval: 30000,
  });

  const trades = data?.data?.trades || [];

  const getStatusBadge = (status: Trade['status']) => {
    const styles: Record<Trade['status'], string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      reverted: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {status}
      </span>
    );
  };

  const getActionBadge = (action: Trade['action']) => {
    const styles: Record<Trade['action'], string> = {
      swap: 'bg-blue-100 text-blue-800',
      lend: 'bg-purple-100 text-purple-800',
      borrow: 'bg-orange-100 text-orange-800',
      repay: 'bg-green-100 text-green-800',
      flash_loan: 'bg-pink-100 text-pink-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[action]}`}>
        {action.replace('_', ' ')}
      </span>
    );
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (isPending) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Trade History</h1>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card">
          <p className="text-sm text-gray-500">Total Trades</p>
          <p className="text-2xl font-bold">{trades.length}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Successful</p>
          <p className="text-2xl font-bold text-green-600">
            {trades.filter((t) => t.status === 'success').length}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Failed</p>
          <p className="text-2xl font-bold text-red-600">
            {trades.filter((t) => t.status === 'failed' || t.status === 'reverted').length}
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Total Profit</p>
          <p className="text-2xl font-bold text-green-600">
            ${trades
              .filter((t) => t.profitUsd)
              .reduce((sum, t) => sum + parseFloat(t.profitUsd || '0'), 0)
              .toFixed(4)}
          </p>
        </div>
      </div>

      {/* Trades List */}
      {trades.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">
            No trades yet. Start the executor to begin automated trading.
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-b">
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Action</th>
                  <th className="pb-3 font-medium">Protocol</th>
                  <th className="pb-3 font-medium">Chain</th>
                  <th className="pb-3 font-medium">Tx Hash</th>
                  <th className="pb-3 font-medium">Profit</th>
                  <th className="pb-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3">{getStatusBadge(trade.status)}</td>
                    <td className="py-3">{getActionBadge(trade.action)}</td>
                    <td className="py-3 font-medium">{trade.protocol}</td>
                    <td className="py-3 capitalize">{trade.chainId}</td>
                    <td className="py-3">
                      {trade.txHash ? (
                        <a
                          href={`https://etherscan.io/tx/${trade.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:underline font-mono"
                        >
                          {formatAddress(trade.txHash)}
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3">
                      {trade.profitUsd ? (
                        <span className={parseFloat(trade.profitUsd) >= 0 ? 'text-green-600' : 'text-red-600'}>
                          ${parseFloat(trade.profitUsd).toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3 text-gray-500">
                      {formatDistanceToNow(new Date(trade.createdAt), { addSuffix: true })}
                    </td>
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
