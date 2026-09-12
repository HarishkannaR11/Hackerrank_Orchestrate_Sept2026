import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, ShieldAlert, AlertTriangle, FileQuestion, CheckCircle, XCircle } from 'lucide-react';
import { api } from '../api';

interface ReviewQueueProps {
  runId: string;
}

const ReviewQueue: React.FC<ReviewQueueProps> = ({ runId }) => {
  const queryClient = useQueryClient();

  const { data: queue, isLoading, isError } = useQuery({
    queryKey: ['runs', runId, 'reviewQueue'],
    queryFn: () => api.getReviewQueue(runId),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ rowId, action }: { rowId: string, action: 'accept' | 'override' }) => 
      api.resolveReviewItem(runId, rowId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs', runId, 'reviewQueue'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-3 font-medium">Loading review queue...</span>
      </div>
    );
  }

  if (isError || !queue) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500">
        <AlertCircle className="w-8 h-8" />
        <span className="ml-3 font-medium">Failed to load review queue.</span>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle className="mx-auto h-12 w-12 text-green-400 mb-3" />
        <h3 className="text-sm font-medium text-gray-900">Queue is empty</h3>
        <p className="mt-1 text-sm text-gray-500">No items currently require human review.</p>
      </div>
    );
  }

  // Sort queue: injection > validation > low_confidence
  const sortedQueue = [...queue].sort((a, b) => {
    const priority = { 'injection_pattern': 1, 'validation_fallback': 2, 'low_confidence': 3 };
    return priority[a.flag_reason] - priority[b.flag_reason];
  });

  const getFlagIcon = (reason: string) => {
    switch (reason) {
      case 'injection_pattern': return <ShieldAlert className="w-5 h-5 text-red-500" />;
      case 'validation_fallback': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'low_confidence': return <FileQuestion className="w-5 h-5 text-blue-500" />;
      default: return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getFlagColor = (reason: string) => {
    switch (reason) {
      case 'injection_pattern': return 'bg-red-50 border-red-200';
      case 'validation_fallback': return 'bg-amber-50 border-amber-200';
      case 'low_confidence': return 'bg-blue-50 border-blue-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-4">
      {sortedQueue.map((item) => (
        <div key={item.id} className={`rounded-lg border p-5 ${getFlagColor(item.flag_reason)}`}>
          <div className="flex items-start justify-between gap-4">
            
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-2">
                {getFlagIcon(item.flag_reason)}
                <h3 className="text-sm font-bold text-gray-900 capitalize tracking-wide">
                  {item.flag_reason.replace(/_/g, ' ')}
                </h3>
                <span className="text-xs text-gray-500 font-mono ml-2">Request: {item.request_id}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Source Content */}
                <div className="bg-white p-3 rounded shadow-sm border border-gray-200">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Source: {item.source_type}
                  </h4>
                  {item.source_type === 'image' ? (
                    <div className="border border-gray-200 rounded overflow-hidden">
                       {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.source_content} alt="Receipt" className="max-h-48 object-contain w-full bg-gray-100" />
                    </div>
                  ) : (
                    <div className="text-sm text-gray-800 font-medium whitespace-pre-wrap">
                      {/* React inherently escapes string text nodes, preventing XSS */}
                      {item.source_content}
                    </div>
                  )}
                </div>

                {/* Extracted Value */}
                <div className="bg-white p-3 rounded shadow-sm border border-gray-200">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Extracted Delta</h4>
                  <pre className="text-xs text-gray-800 whitespace-pre-wrap font-mono">
                    {/* Rendered as plain text to avoid executing anything embedded */}
                    {item.extracted_value}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => resolveMutation.mutate({ rowId: item.id, action: 'accept' })}
                disabled={resolveMutation.isPending}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-green-600 text-white text-xs font-semibold rounded shadow-sm hover:bg-green-500 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Accept
              </button>
              <button
                onClick={() => resolveMutation.mutate({ rowId: item.id, action: 'override' })}
                disabled={resolveMutation.isPending}
                className="inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-semibold rounded shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-4 h-4 text-red-500" />
                Override
              </button>
            </div>

          </div>
        </div>
      ))}
    </div>
  );
};

export default ReviewQueue;
