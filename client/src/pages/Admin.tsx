import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import clsx from 'clsx';

type Tab = 'tokens' | 'protocols' | 'chains' | 'strategies';

interface Token {
  id: string;
  address: string;
  chainId: string;
  symbol: string;
  name: string;
  decimals: string;
  logoUrl?: string;
  enabled: boolean;
}

interface Protocol {
  id: string;
  name: string;
  type: 'dex' | 'lending' | 'aggregator' | 'bridge';
  chainId: string;
  routerAddress?: string;
  factoryAddress?: string;
  enabled: boolean;
}

interface Chain {
  id: string;
  name: string;
  chainIdNumeric: string;
  rpcUrl?: string;
  explorerUrl?: string;
  nativeToken: string;
  enabled: boolean;
}

interface Strategy {
  id: string;
  name: string;
  type: string;
  description?: string;
  enabled: boolean;
  riskLevel: string;
  config: Record<string, unknown>;
}

export default function Admin() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('tokens');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<Token | Protocol | Chain | Strategy | null>(null);

  // Tokens query
  const { data: tokensData, isLoading: tokensLoading } = useQuery({
    queryKey: ['admin-tokens'],
    queryFn: () => api.get<{ data: { tokens: Token[] } }>('/admin/tokens?limit=100'),
    enabled: activeTab === 'tokens',
  });

  // Protocols query
  const { data: protocolsData, isLoading: protocolsLoading } = useQuery({
    queryKey: ['admin-protocols'],
    queryFn: () => api.get<{ data: { protocols: Protocol[] } }>('/admin/protocols?limit=100'),
    enabled: activeTab === 'protocols',
  });

  // Chains query
  const { data: chainsData, isLoading: chainsLoading } = useQuery({
    queryKey: ['admin-chains'],
    queryFn: () => api.get<{ data: { chains: Chain[] } }>('/admin/chains?limit=100'),
    enabled: activeTab === 'chains',
  });

  // Strategies query
  const { data: strategiesData, isLoading: strategiesLoading } = useQuery({
    queryKey: ['admin-strategies'],
    queryFn: () => api.get<{ data: { strategies: Strategy[] } }>('/strategies?limit=100'),
    enabled: activeTab === 'strategies',
  });

  // Toggle mutations
  const toggleTokenMutation = useMutation({
    mutationFn: (token: Token) =>
      api.patch(`/admin/tokens/${token.id}`, { enabled: !token.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-tokens'] }),
  });

  const toggleProtocolMutation = useMutation({
    mutationFn: (protocol: Protocol) =>
      api.patch(`/admin/protocols/${protocol.id}`, { enabled: !protocol.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-protocols'] }),
  });

  const toggleChainMutation = useMutation({
    mutationFn: (chain: Chain) =>
      api.patch(`/admin/chains/${chain.id}`, { enabled: !chain.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-chains'] }),
  });

  const toggleStrategyMutation = useMutation({
    mutationFn: (strategy: Strategy) =>
      api.patch(`/strategies/${strategy.id}`, { enabled: !strategy.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-strategies'] }),
  });

  // Delete mutations
  const deleteTokenMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/tokens/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-tokens'] }),
  });

  const deleteProtocolMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/protocols/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-protocols'] }),
  });

  const deleteChainMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/chains/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-chains'] }),
  });

  const deleteStrategyMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/strategies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-strategies'] }),
  });

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'tokens', label: 'Tokens', icon: '🪙' },
    { id: 'protocols', label: 'Protocols', icon: '🔗' },
    { id: 'chains', label: 'Chains', icon: '⛓️' },
    { id: 'strategies', label: 'Strategies', icon: '📈' },
  ];

  const isLoading =
    (activeTab === 'tokens' && tokensLoading) ||
    (activeTab === 'protocols' && protocolsLoading) ||
    (activeTab === 'chains' && chainsLoading) ||
    (activeTab === 'strategies' && strategiesLoading);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Admin Configuration</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary"
        >
          Add {activeTab.slice(0, -1)}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2',
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="card">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : (
          <>
            {activeTab === 'tokens' && (
              <TokensTable
                tokens={tokensData?.data?.tokens || []}
                onToggle={(token) => toggleTokenMutation.mutate(token)}
                onEdit={setEditItem}
                onDelete={(id) => deleteTokenMutation.mutate(id)}
              />
            )}
            {activeTab === 'protocols' && (
              <ProtocolsTable
                protocols={protocolsData?.data?.protocols || []}
                onToggle={(protocol) => toggleProtocolMutation.mutate(protocol)}
                onEdit={setEditItem}
                onDelete={(id) => deleteProtocolMutation.mutate(id)}
              />
            )}
            {activeTab === 'chains' && (
              <ChainsTable
                chains={chainsData?.data?.chains || []}
                onToggle={(chain) => toggleChainMutation.mutate(chain)}
                onEdit={setEditItem}
                onDelete={(id) => deleteChainMutation.mutate(id)}
              />
            )}
            {activeTab === 'strategies' && (
              <StrategiesTable
                strategies={strategiesData?.data?.strategies || []}
                onToggle={(strategy) => toggleStrategyMutation.mutate(strategy)}
                onEdit={setEditItem}
                onDelete={(id) => deleteStrategyMutation.mutate(id)}
              />
            )}
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editItem) && (
        <AddEditModal
          type={activeTab}
          item={editItem}
          onClose={() => {
            setShowAddModal(false);
            setEditItem(null);
          }}
        />
      )}
    </div>
  );
}

// Tokens Table Component
function TokensTable({
  tokens,
  onToggle,
  onEdit,
  onDelete,
}: {
  tokens: Token[];
  onToggle: (token: Token) => void;
  onEdit: (token: Token) => void;
  onDelete: (id: string) => void;
}) {
  if (tokens.length === 0) {
    return <p className="text-gray-500 text-center py-8">No tokens configured</p>;
  }

  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead>
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chain</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Decimals</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {tokens.map((token) => (
          <tr key={token.id}>
            <td className="px-4 py-3 font-mono font-medium">{token.symbol}</td>
            <td className="px-4 py-3">{token.name}</td>
            <td className="px-4 py-3 capitalize">{token.chainId}</td>
            <td className="px-4 py-3">{token.decimals}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => onToggle(token)}
                className={clsx(
                  'px-2 py-1 rounded-full text-xs font-medium',
                  token.enabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                )}
              >
                {token.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(token)}
                  className="text-primary-600 hover:text-primary-800 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(token.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Protocols Table Component
function ProtocolsTable({
  protocols,
  onToggle,
  onEdit,
  onDelete,
}: {
  protocols: Protocol[];
  onToggle: (protocol: Protocol) => void;
  onEdit: (protocol: Protocol) => void;
  onDelete: (id: string) => void;
}) {
  if (protocols.length === 0) {
    return <p className="text-gray-500 text-center py-8">No protocols configured</p>;
  }

  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead>
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chain</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Router</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {protocols.map((protocol) => (
          <tr key={protocol.id}>
            <td className="px-4 py-3 font-medium">{protocol.name}</td>
            <td className="px-4 py-3 capitalize">{protocol.type}</td>
            <td className="px-4 py-3 capitalize">{protocol.chainId}</td>
            <td className="px-4 py-3 font-mono text-xs">
              {protocol.routerAddress ? `${protocol.routerAddress.slice(0, 10)}...` : '-'}
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => onToggle(protocol)}
                className={clsx(
                  'px-2 py-1 rounded-full text-xs font-medium',
                  protocol.enabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                )}
              >
                {protocol.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(protocol)}
                  className="text-primary-600 hover:text-primary-800 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(protocol.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Chains Table Component
function ChainsTable({
  chains,
  onToggle,
  onEdit,
  onDelete,
}: {
  chains: Chain[];
  onToggle: (chain: Chain) => void;
  onEdit: (chain: Chain) => void;
  onDelete: (id: string) => void;
}) {
  if (chains.length === 0) {
    return <p className="text-gray-500 text-center py-8">No chains configured</p>;
  }

  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead>
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chain ID</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Native Token</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {chains.map((chain) => (
          <tr key={chain.id}>
            <td className="px-4 py-3 font-mono">{chain.id}</td>
            <td className="px-4 py-3 font-medium">{chain.name}</td>
            <td className="px-4 py-3">{chain.chainIdNumeric}</td>
            <td className="px-4 py-3">{chain.nativeToken}</td>
            <td className="px-4 py-3">
              <button
                onClick={() => onToggle(chain)}
                className={clsx(
                  'px-2 py-1 rounded-full text-xs font-medium',
                  chain.enabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                )}
              >
                {chain.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(chain)}
                  className="text-primary-600 hover:text-primary-800 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(chain.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Strategies Table Component
function StrategiesTable({
  strategies,
  onToggle,
  onEdit,
  onDelete,
}: {
  strategies: Strategy[];
  onToggle: (strategy: Strategy) => void;
  onEdit: (strategy: Strategy) => void;
  onDelete: (id: string) => void;
}) {
  if (strategies.length === 0) {
    return <p className="text-gray-500 text-center py-8">No strategies configured</p>;
  }

  const riskColors: Record<string, string> = {
    low: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    high: 'bg-red-100 text-red-800',
  };

  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead>
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {strategies.map((strategy) => (
          <tr key={strategy.id}>
            <td className="px-4 py-3">
              <div>
                <p className="font-medium">{strategy.name}</p>
                {strategy.description && (
                  <p className="text-xs text-gray-500">{strategy.description}</p>
                )}
              </div>
            </td>
            <td className="px-4 py-3 capitalize">{strategy.type.replace('-', ' ')}</td>
            <td className="px-4 py-3">
              <span className={clsx('px-2 py-1 rounded-full text-xs font-medium', riskColors[strategy.riskLevel])}>
                {strategy.riskLevel}
              </span>
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => onToggle(strategy)}
                className={clsx(
                  'px-2 py-1 rounded-full text-xs font-medium',
                  strategy.enabled
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                )}
              >
                {strategy.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => onEdit(strategy)}
                  className="text-primary-600 hover:text-primary-800 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(strategy.id)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Add/Edit Modal Component
function AddEditModal({
  type,
  item,
  onClose,
}: {
  type: Tab;
  item: Token | Protocol | Chain | Strategy | null;
  onClose: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const isEdit = item !== null;

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      const endpoint = type === 'strategies' ? '/strategies' : `/admin/${type}`;
      return isEdit
        ? api.patch(`${endpoint}/${item.id}`, data)
        : api.post(endpoint, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-${type}`] });
      if (type === 'strategies') {
        queryClient.invalidateQueries({ queryKey: ['admin-strategies'] });
      }
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: Record<string, unknown> = {};

    formData.forEach((value, key) => {
      if (key === 'decimals' || key === 'chainIdNumeric') {
        data[key] = parseInt(value as string, 10);
      } else if (key === 'enabled') {
        data[key] = value === 'true';
      } else {
        data[key] = value;
      }
    });

    createMutation.mutate(data);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">
          {isEdit ? 'Edit' : 'Add'} {type.slice(0, -1)}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {type === 'tokens' && <TokenForm item={item as Token | null} />}
          {type === 'protocols' && <ProtocolForm item={item as Protocol | null} />}
          {type === 'chains' && <ChainForm item={item as Chain | null} />}
          {type === 'strategies' && <StrategyForm item={item as Strategy | null} />}

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn btn-primary"
            >
              {createMutation.isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Form Components
function TokenForm({ item }: { item: Token | null }) {
  return (
    <>
      <div>
        <label className="label">Address</label>
        <input
          type="text"
          name="address"
          defaultValue={item?.address}
          className="input"
          placeholder="0x..."
          required
          disabled={!!item}
        />
      </div>
      <div>
        <label className="label">Chain</label>
        <select name="chainId" defaultValue={item?.chainId || 'ethereum'} className="input" disabled={!!item}>
          <option value="ethereum">Ethereum</option>
          <option value="arbitrum">Arbitrum</option>
          <option value="base">Base</option>
          <option value="polygon">Polygon</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Symbol</label>
          <input type="text" name="symbol" defaultValue={item?.symbol} className="input" required />
        </div>
        <div>
          <label className="label">Decimals</label>
          <input
            type="number"
            name="decimals"
            defaultValue={item?.decimals || '18'}
            className="input"
            min="0"
            max="18"
            required
          />
        </div>
      </div>
      <div>
        <label className="label">Name</label>
        <input type="text" name="name" defaultValue={item?.name} className="input" required />
      </div>
      <div>
        <label className="label">Logo URL (optional)</label>
        <input type="url" name="logoUrl" defaultValue={item?.logoUrl} className="input" />
      </div>
    </>
  );
}

function ProtocolForm({ item }: { item: Protocol | null }) {
  return (
    <>
      <div>
        <label className="label">Name</label>
        <input type="text" name="name" defaultValue={item?.name} className="input" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Type</label>
          <select name="type" defaultValue={item?.type || 'dex'} className="input">
            <option value="dex">DEX</option>
            <option value="lending">Lending</option>
            <option value="aggregator">Aggregator</option>
            <option value="bridge">Bridge</option>
          </select>
        </div>
        <div>
          <label className="label">Chain</label>
          <select name="chainId" defaultValue={item?.chainId || 'ethereum'} className="input">
            <option value="ethereum">Ethereum</option>
            <option value="arbitrum">Arbitrum</option>
            <option value="base">Base</option>
            <option value="polygon">Polygon</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Router Address (optional)</label>
        <input type="text" name="routerAddress" defaultValue={item?.routerAddress} className="input" />
      </div>
      <div>
        <label className="label">Factory Address (optional)</label>
        <input type="text" name="factoryAddress" defaultValue={item?.factoryAddress} className="input" />
      </div>
    </>
  );
}

function ChainForm({ item }: { item: Chain | null }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">ID</label>
          <input
            type="text"
            name="id"
            defaultValue={item?.id}
            className="input"
            placeholder="ethereum"
            required
            disabled={!!item}
          />
        </div>
        <div>
          <label className="label">Chain ID (numeric)</label>
          <input
            type="number"
            name="chainIdNumeric"
            defaultValue={item?.chainIdNumeric || '1'}
            className="input"
            required
          />
        </div>
      </div>
      <div>
        <label className="label">Name</label>
        <input type="text" name="name" defaultValue={item?.name} className="input" required />
      </div>
      <div>
        <label className="label">Native Token</label>
        <input type="text" name="nativeToken" defaultValue={item?.nativeToken || 'ETH'} className="input" required />
      </div>
      <div>
        <label className="label">RPC URL (optional)</label>
        <input type="url" name="rpcUrl" defaultValue={item?.rpcUrl} className="input" />
      </div>
      <div>
        <label className="label">Explorer URL (optional)</label>
        <input type="url" name="explorerUrl" defaultValue={item?.explorerUrl} className="input" />
      </div>
    </>
  );
}

function StrategyForm({ item }: { item: Strategy | null }) {
  return (
    <>
      <div>
        <label className="label">Name</label>
        <input type="text" name="name" defaultValue={item?.name} className="input" required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Type</label>
          <select name="type" defaultValue={item?.type || 'cross-exchange'} className="input">
            <option value="cross-exchange">Cross Exchange</option>
            <option value="triangular">Triangular</option>
            <option value="cross-chain">Cross Chain</option>
            <option value="flash-loan">Flash Loan</option>
            <option value="liquidation">Liquidation</option>
          </select>
        </div>
        <div>
          <label className="label">Risk Level</label>
          <select name="riskLevel" defaultValue={item?.riskLevel || 'medium'} className="input">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Description (optional)</label>
        <textarea name="description" defaultValue={item?.description} className="input" rows={2} />
      </div>
    </>
  );
}
