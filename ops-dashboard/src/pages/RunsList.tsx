import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Play, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { RunSummary } from '../types';

const RunsList: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: runs, isLoading, isError } = useQuery<RunSummary[]>({
    queryKey: ['runs'],
    queryFn: api.getRuns,
  });

  const startRunMutation = useMutation({
    mutationFn: api.startRun,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      navigate(`/runs/${data.id}`);
    },
  });

  const handleStartRun = () => {
    startRunMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span className="ml-3 font-medium">Loading runs...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <AlertCircle className="w-8 h-8" />
        <span className="ml-3 font-medium">Failed to load runs. Is the API up?</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Pipeline Runs</h1>
        <button
          onClick={handleStartRun}
          disabled={startRunMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-md shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {startRunMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
          Start New Run
        </button>
      </div>

      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Run ID</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Started At</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">View</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {runs?.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No runs found. Start one!</td>
              </tr>
            ) : (
              runs?.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 font-mono">
                    {run.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                      ${run.status === 'done' ? 'bg-green-100 text-green-800' : ''}
                      ${run.status === 'failed' ? 'bg-red-100 text-red-800' : ''}
                      ${run.status === 'running' ? 'bg-blue-100 text-blue-800 animate-pulse' : ''}
                      ${run.status === 'queued' ? 'bg-gray-100 text-gray-800' : ''}
                    `}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {run.rows_processed} / {run.total_rows}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => navigate(`/runs/${run.id}`)}
                      className="text-indigo-600 hover:text-indigo-900 font-semibold"
                    >
                      View detail &rarr;
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RunsList;
