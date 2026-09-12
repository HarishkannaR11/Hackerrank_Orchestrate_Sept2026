import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../api';
import OutputTable from '../components/OutputTable';
import ReviewQueue from '../components/ReviewQueue';
import UsageReportTab from '../components/UsageReportTab';

const RunDetail: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const [activeTab, setActiveTab] = useState<'output' | 'review' | 'usage'>('output');

  // Polling for status
  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ['runs', runId, 'status'],
    queryFn: () => api.getRunStatus(runId!),
    refetchInterval: (query) => {
      // stop polling if done or failed
      if (query.state.data?.status === 'done' || query.state.data?.status === 'failed') {
        return false;
      }
      return 2000;
    },
    enabled: !!runId,
  });

  // Fetch Review Queue to get count for badge
  const { data: reviewQueue } = useQuery({
    queryKey: ['runs', runId, 'reviewQueue'],
    queryFn: () => api.getReviewQueue(runId!),
    enabled: !!runId,
  });

  if (isStatusLoading || !status) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-3 font-medium">Loading run details...</span>
      </div>
    );
  }

  const progressPercent = status.total_rows > 0 ? Math.round((status.rows_processed / status.total_rows) * 100) : 0;
  const reviewCount = reviewQueue?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-3">
            Run {status.id}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium capitalize border
              ${status.status === 'done' ? 'bg-green-50 text-green-700 border-green-200' : ''}
              ${status.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' : ''}
              ${status.status === 'running' ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse' : ''}
              ${status.status === 'queued' ? 'bg-gray-50 text-gray-700 border-gray-200' : ''}
            `}>
              {status.status}
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">Started {new Date(status.started_at).toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
          <span>Progress</span>
          <span>{status.rows_processed} / {status.total_rows} ({progressPercent}%)</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
          <div 
            className={`h-2.5 rounded-full transition-all duration-500 ${status.status === 'failed' ? 'bg-red-600' : 'bg-indigo-600'}`} 
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('output')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === 'output' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
              `}
            >
              Output
            </button>
            <button
              onClick={() => setActiveTab('review')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2
                ${activeTab === 'review' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
              `}
            >
              Review Queue
              {reviewCount > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                  {reviewCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('usage')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                ${activeTab === 'usage' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
              `}
            >
              Usage Report
            </button>
          </nav>
        </div>
        
        <div className="p-6">
          {activeTab === 'output' && <OutputTable runId={runId!} />}
          {activeTab === 'review' && <ReviewQueue runId={runId!} />}
          {activeTab === 'usage' && <UsageReportTab runId={runId!} />}
        </div>
      </div>
    </div>
  );
};

export default RunDetail;
