import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { formatDistanceToNow } from 'date-fns';
import CreateDelegationForm from '../components/CreateDelegationForm';
import { PROTOCOLS } from '../constants/protocols';

interface Delegation {
  id: string;
  walletAddress: string;
  sessionKeyAddress: string;
  chainId: string;
  allowedProtocols: string[];
  allowedTokens: string[];
  status: 'active' | 'paused' | 'revoked' | 'expired';
  validFrom: string;
  validUntil: string;
  createdAt: string;
  limits: {
    maxPerTrade: string;
    maxDailyVolume: string;
    maxWeeklyVolume: string;
    currentDailyVolume: string;
    currentWeeklyVolume: string;
    maxLeverage: string;
  } | null;
}

export default function Delegations() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ['/api/delegations'],
    queryFn: () => api.get<{ data: Delegation[] }>('/delegations'),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/delegations/${id}/pause`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/delegations'] }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/delegations/${id}/resume`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/delegations'] }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/delegations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/delegations'] }),
  });

  const delegations = data?.data || [];

  const getStatusBadge = (status: Delegation['status']) => {
    const styles: Record<Delegation['status'], string> = {
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      revoked: 'bg-red-100 text-red-800',
      expired: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {status}
      </span>
    );
  };

  if (isPending) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Delegations</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
        >
          Create Delegation
        </button>
      </div>

      {delegations.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-4">
            No delegations yet. Create one to start automated trading.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary"
          >
            Create Your First Delegation
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {delegations.map((delegation) => (
            <div key={delegation.id} className="card">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">Session Key</span>
                    {getStatusBadge(delegation.status)}
                  </div>
                  <p className="text-sm font-mono text-gray-600">
                    {delegation.sessionKeyAddress}
                  </p>
                </div>
                <div className="flex gap-2">
                  {delegation.status === 'active' && (
                    <button
                      onClick={() => pauseMutation.mutate(delegation.id)}
                      className="btn btn-secondary text-sm"
                    >
                      Pause
                    </button>
                  )}
                  {delegation.status === 'paused' && (
                    <button
                      onClick={() => resumeMutation.mutate(delegation.id)}
                      className="btn btn-primary text-sm"
                    >
                      Resume
                    </button>
                  )}
                  {(delegation.status === 'active' || delegation.status === 'paused') && (
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to revoke this delegation?')) {
                          revokeMutation.mutate(delegation.id);
                        }
                      }}
                      className="btn btn-danger text-sm"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Chain</p>
                  <p className="font-medium capitalize">{delegation.chainId}</p>
                </div>
                <div>
                  <p className="text-gray-500">Protocols</p>
                  <p className="font-medium">
                    {delegation.allowedProtocols
                      .map((p) => PROTOCOLS.find((pr) => pr.id === p)?.name || p)
                      .join(', ')}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Valid Until</p>
                  <p className="font-medium">
                    {formatDistanceToNow(new Date(delegation.validUntil), { addSuffix: true })}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Created</p>
                  <p className="font-medium">
                    {formatDistanceToNow(new Date(delegation.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>

              {delegation.limits && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm font-medium text-gray-700 mb-2">Limits</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Max Per Trade</p>
                      <p className="font-medium">${delegation.limits.maxPerTrade}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Daily Volume</p>
                      <p className="font-medium">
                        ${delegation.limits.currentDailyVolume} / ${delegation.limits.maxDailyVolume}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Weekly Volume</p>
                      <p className="font-medium">
                        ${delegation.limits.currentWeeklyVolume} / ${delegation.limits.maxWeeklyVolume}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Max Leverage</p>
                      <p className="font-medium">{delegation.limits.maxLeverage}x</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Delegation Modal */}
      {showCreateModal && (
        <CreateDelegationForm
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
