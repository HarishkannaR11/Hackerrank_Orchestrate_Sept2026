import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../api';

interface OutputTableProps {
  runId: string;
}

const statusColors: Record<string, string> = {
  'affordable_now': 'bg-green-100 text-green-800',
  'affordable_with_plan': 'bg-amber-100 text-amber-800',
  'affordable_later': 'bg-blue-100 text-blue-800',
  'not_affordable': 'bg-red-100 text-red-800',
};

const OutputTable: React.FC<OutputTableProps> = ({ runId }) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: output, isLoading, isError } = useQuery({
    queryKey: ['runs', runId, 'output'],
    queryFn: () => api.getRunOutput(runId),
  });

  const toggleRow = (id: string) => {
    const newSet = new Set(expandedRows);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedRows(newSet);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-3 font-medium">Loading output...</span>
      </div>
    );
  }

  if (isError || !output) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500">
        <AlertCircle className="w-8 h-8" />
        <span className="ml-3 font-medium">Failed to load run output.</span>
      </div>
    );
  }

  if (output.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No output generated yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 border-t border-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Request ID</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Safe Amount</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full Safe Date</th>
            <th scope="col" className="relative px-4 py-3"><span className="sr-only">Expand</span></th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {output.map((row) => (
            <React.Fragment key={row.request_id}>
              <tr 
                className="hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => toggleRow(row.request_id)}
              >
                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 font-mono">
                  {row.request_id}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[row.affordability_status] || 'bg-gray-100 text-gray-800'}`}>
                    {row.affordability_status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                  {row.recommended_payment_method.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-900 text-right">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.amount_safe_to_pay)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                  {row.earliest_date_for_full_payment ? (
                    <span className="font-mono">{row.earliest_date_for_full_payment}</span>
                  ) : (
                    <span className="italic text-gray-400">No safe date found</span>
                  )}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-400">
                  {expandedRows.has(row.request_id) ? <ChevronUp className="w-5 h-5 ml-auto" /> : <ChevronDown className="w-5 h-5 ml-auto" />}
                </td>
              </tr>
              
              {expandedRows.has(row.request_id) && (
                <tr className="bg-gray-50">
                  <td colSpan={6} className="px-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Explanation</h4>
                        <p className="text-sm text-gray-900">{row.decision_explanation}</p>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Payment Plan</h4>
                          <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
                            {row.payment_plan}
                          </pre>
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Spending Changes Needed</h4>
                          <pre className="text-xs bg-white p-3 rounded border border-gray-200 overflow-x-auto">
                            {row.spending_changes_needed}
                          </pre>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OutputTable;
