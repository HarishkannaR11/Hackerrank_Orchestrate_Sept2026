import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface UsageReportTabProps {
  runId: string;
}

const UsageReportTab: React.FC<UsageReportTabProps> = ({ runId }) => {
  const { data: usage, isLoading, isError } = useQuery({
    queryKey: ['runs', runId, 'usage'],
    queryFn: () => api.getUsageReport(runId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-3 font-medium">Loading usage report...</span>
      </div>
    );
  }

  if (isError || !usage) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500">
        <AlertCircle className="w-8 h-8" />
        <span className="ml-3 font-medium">Failed to load usage report. (It may only be available when the run finishes)</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 p-5">
          <dt className="text-sm font-medium text-gray-500 truncate">Total LLM Calls</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{usage.summary.total_calls}</dd>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 p-5">
          <dt className="text-sm font-medium text-gray-500 truncate">Total Tokens</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">{usage.summary.total_tokens.toLocaleString()}</dd>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 p-5">
          <dt className="text-sm font-medium text-gray-500 truncate">Total Cost</dt>
          <dd className="mt-1 text-3xl font-semibold text-indigo-600">${usage.summary.total_cost.toFixed(4)}</dd>
        </div>
        <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 p-5">
          <dt className="text-sm font-medium text-gray-500 truncate">Avg Cost / Request</dt>
          <dd className="mt-1 text-3xl font-semibold text-gray-900">
            ${(usage.summary.total_cost / usage.summary.requests_processed || 0).toFixed(4)}
          </dd>
        </div>
      </div>

      {/* Model Breakdown Chart */}
      <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
        <h3 className="text-lg leading-6 font-medium text-gray-900 mb-6">Token Usage by Model</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={usage.models}
              margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip cursor={{fill: 'transparent'}} />
              <Bar dataKey="input_tokens" name="Input Tokens" stackId="a" fill="#818cf8" radius={[0, 0, 4, 4]} />
              <Bar dataKey="output_tokens" name="Output Tokens" stackId="a" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default UsageReportTab;
