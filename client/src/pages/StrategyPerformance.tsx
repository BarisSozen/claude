import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import clsx from 'clsx';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { format, parseISO } from 'date-fns';

type Period = 'day' | 'week' | 'month' | 'year' | 'ytd' | 'all';

interface Strategy {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  riskLevel: string;
}

interface MetricsSummary {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  grossProfitUsd: number;
  gasSpentUsd: number;
  netProfitUsd: number;
  totalVolumeUsd: number;
  maxDrawdownPercent: number;
}

interface SnapshotData {
  date: string;
  tradeCount: number;
  netProfitUsd: number;
  volumeUsd: number;
  successRate: number;
  cumulativeProfitUsd: number;
}

interface StrategyMetrics {
  strategy: Strategy;
  period: string;
  dateRange: { start: string; end: string };
  summary: MetricsSummary;
  snapshots: SnapshotData[];
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function StrategyPerformance() {
  const api = useApi();
  const [period, setPeriod] = useState<Period>('month');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('all');

  // Fetch all strategies
  const { data: strategiesData } = useQuery({
    queryKey: ['strategies-list'],
    queryFn: () => api.get<{ data: { strategies: Strategy[] } }>('/strategies?limit=100'),
  });

  // Fetch summary metrics
  const { data: summaryData } = useQuery({
    queryKey: ['strategy-metrics-summary', period, selectedStrategy],
    queryFn: () => {
      const params = new URLSearchParams({ period });
      if (selectedStrategy !== 'all') {
        params.set('strategyId', selectedStrategy);
      }
      return api.get<{
        data: {
          metrics: MetricsSummary;
          dateRange: { start: string; end: string };
        };
      }>(`/strategies/metrics/summary?${params}`);
    },
  });

  // Fetch individual strategy metrics
  const { data: strategyMetrics } = useQuery({
    queryKey: ['strategy-metrics', period, selectedStrategy],
    queryFn: () =>
      api.get<{ data: StrategyMetrics }>(
        `/strategies/${selectedStrategy}/metrics?period=${period}`
      ),
    enabled: selectedStrategy !== 'all',
  });

  const strategies = strategiesData?.data?.strategies || [];
  const summary = summaryData?.data?.metrics;
  const snapshots = strategyMetrics?.data?.snapshots || [];

  const periods: { id: Period; label: string }[] = [
    { id: 'day', label: '24H' },
    { id: 'week', label: '7D' },
    { id: 'month', label: '30D' },
    { id: 'year', label: '1Y' },
    { id: 'ytd', label: 'YTD' },
    { id: 'all', label: 'All Time' },
  ];

  // Format chart data
  const chartData = snapshots.map((s) => ({
    date: format(parseISO(s.date), 'MMM dd'),
    profit: s.netProfitUsd,
    cumulative: s.cumulativeProfitUsd,
    volume: s.volumeUsd,
    trades: s.tradeCount,
    successRate: s.successRate,
  }));

  // Calculate drawdown data
  const drawdownData = snapshots.map((s, idx) => {
    const peak = snapshots
      .slice(0, idx + 1)
      .reduce((max, snap) => Math.max(max, snap.cumulativeProfitUsd), 0);
    const drawdown = peak > 0 ? ((peak - s.cumulativeProfitUsd) / peak) * 100 : 0;
    return {
      date: format(parseISO(s.date), 'MMM dd'),
      drawdown: -drawdown,
    };
  });

  // Strategy distribution data for pie chart
  const strategyTypeData = strategies.reduce((acc, s) => {
    const type = s.type.replace('-', ' ');
    const existing = acc.find((a) => a.name === type);
    if (existing) {
      existing.value++;
    } else {
      acc.push({ name: type, value: 1 });
    }
    return acc;
  }, [] as { name: string; value: number }[]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Strategy Performance</h1>

        <div className="flex gap-4">
          {/* Strategy selector */}
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="input w-48"
          >
            <option value="all">All Strategies</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Period selector */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {periods.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={clsx(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  period === p.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Net Profit"
          value={summary?.netProfitUsd || 0}
          format="currency"
          trend={summary && summary.netProfitUsd > 0 ? 'up' : 'down'}
        />
        <MetricCard
          title="Total Volume"
          value={summary?.totalVolumeUsd || 0}
          format="currency"
        />
        <MetricCard
          title="Success Rate"
          value={summary?.successRate || 0}
          format="percent"
          trend={summary && summary.successRate > 80 ? 'up' : summary && summary.successRate > 50 ? 'neutral' : 'down'}
        />
        <MetricCard
          title="Max Drawdown"
          value={summary?.maxDrawdownPercent || 0}
          format="percent"
          trend="down"
        />
      </div>

      {/* Trade Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card bg-gray-50">
          <p className="text-sm text-gray-500">Total Trades</p>
          <p className="text-2xl font-bold">{summary?.totalTrades || 0}</p>
        </div>
        <div className="card bg-green-50">
          <p className="text-sm text-gray-500">Successful</p>
          <p className="text-2xl font-bold text-green-600">{summary?.successfulTrades || 0}</p>
        </div>
        <div className="card bg-red-50">
          <p className="text-sm text-gray-500">Failed</p>
          <p className="text-2xl font-bold text-red-600">{summary?.failedTrades || 0}</p>
        </div>
        <div className="card bg-orange-50">
          <p className="text-sm text-gray-500">Gas Spent</p>
          <p className="text-2xl font-bold text-orange-600">
            ${(summary?.gasSpentUsd || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cumulative Profit Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Cumulative Profit</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative Profit']}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#3B82F6"
                  fill="#93C5FD"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Profit Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Daily Net Profit</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']} />
                <Bar
                  dataKey="profit"
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drawdown Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Drawdown</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={drawdownData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} domain={['auto', 0]} />
                <Tooltip formatter={(value: number) => [`${Math.abs(value).toFixed(2)}%`, 'Drawdown']} />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke="#EF4444"
                  fill="#FCA5A5"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Success Rate Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Success Rate Over Time</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(value: number) => [`${value.toFixed(1)}%`, 'Success Rate']} />
                <Line
                  type="monotone"
                  dataKey="successRate"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Volume Chart */}
        <div className="card lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4">Trading Volume</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, 'Volume']} />
                <Bar dataKey="volume" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Distribution */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Strategy Types</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={strategyTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {strategyTypeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Trade Count Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Daily Trade Count</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="trades" fill="#6366F1" radius={[4, 4, 0, 0]} name="Trades" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Strategy List with Performance */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Strategies Overview</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Strategy</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {strategies.map((strategy) => (
                <tr key={strategy.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{strategy.name}</td>
                  <td className="px-4 py-3 capitalize">{strategy.type.replace('-', ' ')}</td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        strategy.riskLevel === 'low' && 'bg-green-100 text-green-800',
                        strategy.riskLevel === 'medium' && 'bg-yellow-100 text-yellow-800',
                        strategy.riskLevel === 'high' && 'bg-red-100 text-red-800'
                      )}
                    >
                      {strategy.riskLevel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        strategy.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {strategy.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedStrategy(strategy.id)}
                      className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({
  title,
  value,
  format,
  trend,
}: {
  title: string;
  value: number;
  format: 'currency' | 'percent' | 'number';
  trend?: 'up' | 'down' | 'neutral';
}) {
  const formatValue = () => {
    switch (format) {
      case 'currency':
        return `$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      case 'percent':
        return `${value.toFixed(2)}%`;
      default:
        return value.toLocaleString();
    }
  };

  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-yellow-600',
  };

  return (
    <div className="card">
      <p className="text-sm text-gray-500">{title}</p>
      <p className={clsx('text-2xl font-bold', trend && trendColors[trend])}>
        {format === 'currency' && value < 0 && '-'}
        {formatValue()}
      </p>
    </div>
  );
}
