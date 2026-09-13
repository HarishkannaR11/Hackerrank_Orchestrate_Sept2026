import { Fragment, useMemo, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SimulationConsole from './SimulationConsole';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

type RunStatus = 'queued' | 'running' | 'done' | 'failed';
type AffordabilityStatus = 'affordable_now' | 'affordable_with_plan' | 'affordable_later' | 'not_affordable';

type Run = {
  id?: string;
  run_id?: string;
  started_at: string;
  status: RunStatus;
  rows_processed: number;
  total_rows: number;
};

type OutputRow = {
  request_id: string;
  amount_safe_to_pay: string | number;
  affordability_status: AffordabilityStatus;
  recommended_payment_method: string;
  payment_plan: string;
  earliest_date_for_full_payment: string | null;
  spending_changes_needed: string;
  decision_explanation: string;
};

type ReviewItem = {
  id?: string;
  row_id?: string;
  request_id?: string;
  flag_reason: string;
  extracted_value: string;
  source_type: 'image' | 'message' | string;
  source_content: string;
  image_url?: string;
};

type UsageReport = {
  models: Array<{
    name: string;
    calls: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  }>;
  summary: {
    total_calls: number;
    total_tokens: number;
    total_cost: number;
    requests_processed: number;
    avg_tokens_per_request?: number;
    avg_cost_per_request?: number;
  };
  raw_markdown: string;
};

const statusStyles: Record<AffordabilityStatus, string> = {
  affordable_now: 'border-emerald-700 bg-emerald-950 text-emerald-200',
  affordable_with_plan: 'border-amber-700 bg-amber-950 text-amber-200',
  affordable_later: 'border-sky-700 bg-sky-950 text-sky-200',
  not_affordable: 'border-red-700 bg-red-950 text-red-200',
};

const runStyles: Record<RunStatus, string> = {
  queued: 'border-slate-600 bg-slate-900 text-slate-200',
  running: 'border-sky-700 bg-sky-950 text-sky-200',
  done: 'border-emerald-700 bg-emerald-950 text-emerald-200',
  failed: 'border-red-700 bg-red-950 text-red-200',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function runId(run: Run) {
  return run.run_id ?? run.id ?? '';
}

function StatusBadge({ value }: { value: RunStatus | AffordabilityStatus }) {
  const className =
    value in runStyles
      ? runStyles[value as RunStatus]
      : statusStyles[value as AffordabilityStatus] ?? 'border-slate-600 bg-slate-900 text-slate-200';
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${className}`}>{value.replaceAll('_', ' ')}</span>;
}

function Panel({ children, title, action }: { children: React.ReactNode; title?: string; action?: React.ReactNode }) {
  return (
    <section className="rounded-md border border-slate-800 bg-slate-950">
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-start gap-3 px-4 py-8 text-sm text-red-200">
      <XCircle className="mt-0.5 h-4 w-4" />
      <pre className="whitespace-pre-wrap font-sans">{error instanceof Error ? error.message : 'Request failed'}</pre>
    </div>
  );
}

function RunsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: () => api<Run[]>('/runs'), refetchInterval: 5000 });
  const startRun = useMutation({
    mutationFn: () => api<{ id: string; run_id?: string }>('/runs', { method: 'POST' }),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      navigate(`/runs/${run.run_id ?? run.id}`);
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Buy-or-Wait Runs</h1>
          <p className="mt-1 text-sm text-slate-400">Operate and audit backend affordability runs.</p>
        </div>
        <button
          onClick={() => startRun.mutate()}
          disabled={startRun.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {startRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Start new run
        </button>
      </div>

      <Panel title="Runs">
        {runsQuery.isLoading && <LoadingState label="Loading runs" />}
        {runsQuery.isError && <ErrorState error={runsQuery.error} />}
        {runsQuery.data?.length === 0 && <div className="px-4 py-8 text-sm text-slate-400">No runs have been started yet.</div>}
        {runsQuery.data && runsQuery.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Run ID</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Rows</th>
                  <th className="px-4 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {runsQuery.data.map((run) => (
                  <tr key={runId(run)} className="border-b border-slate-900">
                    <td className="px-4 py-3 font-mono text-slate-200">{runId(run)}</td>
                    <td className="px-4 py-3 text-slate-300">{run.started_at}</td>
                    <td className="px-4 py-3"><StatusBadge value={run.status} /></td>
                    <td className="px-4 py-3 text-slate-300">{run.rows_processed} / {run.total_rows}</td>
                    <td className="px-4 py-3">
                      <Link className="text-sky-300 hover:text-sky-200" to={`/runs/${runId(run)}`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}

function RunDetail() {
  const { runId: id = '' } = useParams();
  const [tab, setTab] = useState<'output' | 'review' | 'usage'>('output');
  const statusQuery = useQuery({
    queryKey: ['run-status', id],
    queryFn: () => api<Run>(`/runs/${id}/status`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 2000;
    },
  });
  const reviewQuery = useQuery({ queryKey: ['review', id], queryFn: () => api<ReviewItem[]>(`/runs/${id}/review-queue`), refetchInterval: 2000 });
  const run = statusQuery.data;
  const progress = run?.total_rows ? Math.round((run.rows_processed / run.total_rows) * 100) : 0;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Runs
      </Link>

      <Panel>
        <div className="space-y-4 p-4">
          {statusQuery.isLoading && <LoadingState label="Loading run status" />}
          {statusQuery.isError && <ErrorState error={statusQuery.error} />}
          {run && (
            <>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h1 className="font-mono text-xl font-semibold text-slate-50">{id}</h1>
                  <p className="mt-1 text-sm text-slate-400">{run.rows_processed} of {run.total_rows} rows processed</p>
                </div>
                <StatusBadge value={run.status} />
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-800">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </>
          )}
        </div>
      </Panel>

      <div className="flex border-b border-slate-800">
        {[
          ['output', 'Output', null],
          ['review', 'Review queue', reviewQuery.data?.length ?? 0],
          ['usage', 'Usage report', null],
        ].map(([value, label, count]) => (
          <button
            key={value as string}
            onClick={() => setTab(value as 'output' | 'review' | 'usage')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm ${
              tab === value ? 'border-emerald-400 text-slate-50' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
            {typeof count === 'number' && <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">{count}</span>}
          </button>
        ))}
      </div>

      {tab === 'output' && <OutputTab runId={id} />}
      {tab === 'review' && <ReviewTab runId={id} />}
      {tab === 'usage' && <UsageTab runId={id} />}
    </main>
  );
}

function OutputTab({ runId }: { runId: string }) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const outputQuery = useQuery({ queryKey: ['output', runId], queryFn: () => api<OutputRow[]>(`/runs/${runId}/output`), refetchInterval: 4000 });
  const pageSize = 25;
  const rows = outputQuery.data ?? [];
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));

  return (
    <Panel title="Output">
      {outputQuery.isLoading && <LoadingState label="Loading output rows" />}
      {outputQuery.isError && <ErrorState error={outputQuery.error} />}
      {outputQuery.data?.length === 0 && <div className="px-4 py-8 text-sm text-slate-400">No output rows are available for this run yet.</div>}
      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Safe to pay</th>
                  <th className="px-4 py-3">Earliest full</th>
                  <th className="px-4 py-3">Explanation</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const isOpen = expanded === row.request_id;
                  return (
                    <Fragment key={row.request_id}>
                      <tr key={row.request_id} onClick={() => setExpanded(isOpen ? null : row.request_id)} className="cursor-pointer border-b border-slate-900 hover:bg-slate-900">
                        <td className="px-4 py-3">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-4 py-3 font-mono text-slate-200">{row.request_id}</td>
                        <td className="px-4 py-3"><StatusBadge value={row.affordability_status} /></td>
                        <td className="px-4 py-3 text-slate-300">{row.recommended_payment_method}</td>
                        <td className="px-4 py-3 font-mono text-slate-200">{row.amount_safe_to_pay}</td>
                        <td className="px-4 py-3 text-slate-300">{row.earliest_date_for_full_payment || 'No safe date found'}</td>
                        <td className="max-w-xl px-4 py-3 text-slate-300">{row.decision_explanation}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.request_id}-expanded`} className="border-b border-slate-900 bg-slate-950">
                          <td />
                          <td colSpan={6} className="px-4 py-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="text-xs uppercase text-slate-500">Payment plan</div>
                                <pre className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200">{row.payment_plan || 'none'}</pre>
                              </div>
                              <div>
                                <div className="text-xs uppercase text-slate-500">Spending changes</div>
                                <pre className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200">{row.spending_changes_needed || 'none'}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-sm text-slate-400">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <button className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function severity(reason: string) {
  const value = reason.toLowerCase();
  if (value.includes('injection')) return 0;
  if (value.includes('validation')) return 1;
  return 2;
}

function ReviewTab({ runId }: { runId: string }) {
  const queryClient = useQueryClient();
  const reviewQuery = useQuery({ queryKey: ['review', runId], queryFn: () => api<ReviewItem[]>(`/runs/${runId}/review-queue`), refetchInterval: 2000 });
  const resolve = useMutation({
    mutationFn: ({ rowId, action }: { rowId: string; action: 'accept' | 'override' }) =>
      api(`/runs/${runId}/review-queue/${encodeURIComponent(rowId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['review', runId] }),
  });
  const items = useMemo(() => [...(reviewQuery.data ?? [])].sort((a, b) => severity(a.flag_reason) - severity(b.flag_reason)), [reviewQuery.data]);

  return (
    <Panel title="Review queue">
      {reviewQuery.isLoading && <LoadingState label="Loading review queue" />}
      {reviewQuery.isError && <ErrorState error={reviewQuery.error} />}
      {reviewQuery.data?.length === 0 && <div className="px-4 py-8 text-sm text-slate-400">No review items are currently flagged.</div>}
      <div className="divide-y divide-slate-900">
        {items.map((item) => {
          const id = item.row_id ?? item.id ?? item.request_id ?? '';
          return (
            <article key={id} className="grid gap-4 p-4 lg:grid-cols-[1fr_280px]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-200">{item.request_id ?? id}</span>
                  <span className="rounded border border-amber-700 bg-amber-950 px-2 py-1 text-xs text-amber-200">{item.flag_reason}</span>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">Extracted value</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200">{item.extracted_value || 'empty'}</pre>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">Source</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200">{item.source_content || 'empty'}</pre>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {item.source_type === 'image' && item.image_url && <img src={item.image_url} alt="" className="max-h-40 rounded border border-slate-800 object-contain" />}
                <button onClick={() => resolve.mutate({ rowId: id, action: 'accept' })} className="inline-flex h-9 items-center justify-center gap-2 rounded bg-emerald-500 px-3 text-sm font-semibold text-slate-950">
                  <CheckCircle2 className="h-4 w-4" />
                  Accept
                </button>
                <button onClick={() => resolve.mutate({ rowId: id, action: 'override' })} className="inline-flex h-9 items-center justify-center gap-2 rounded border border-slate-700 px-3 text-sm text-slate-200">
                  <AlertTriangle className="h-4 w-4" />
                  Override
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function UsageTab({ runId }: { runId: string }) {
  const usageQuery = useQuery({ queryKey: ['usage', runId], queryFn: () => api<UsageReport>(`/runs/${runId}/usage-report`) });
  const chartData = (usageQuery.data?.models ?? []).map((model) => ({
    name: model.name,
    calls: model.calls,
    tokens: model.total_tokens ?? (model.input_tokens ?? 0) + (model.output_tokens ?? 0),
  }));
  const markdownHref = usageQuery.data ? `data:text/markdown;charset=utf-8,${encodeURIComponent(usageQuery.data.raw_markdown)}` : undefined;

  return (
    <Panel
      title="Usage report"
      action={markdownHref && (
        <a className="inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200" href={markdownHref} download={`${runId}-usage-report.md`}>
          <Download className="h-4 w-4" />
          Download Markdown
        </a>
      )}
    >
      {usageQuery.isLoading && <LoadingState label="Loading usage report" />}
      {usageQuery.isError && <ErrorState error={usageQuery.error} />}
      {usageQuery.data && (
        <div className="space-y-6 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Total calls" value={usageQuery.data.summary.total_calls} />
            <Metric label="Total tokens" value={usageQuery.data.summary.total_tokens} />
            <Metric label="Total cost" value={`$${Number(usageQuery.data.summary.total_cost).toFixed(4)}`} />
            <Metric label="Avg cost/request" value={`$${Number(usageQuery.data.summary.avg_cost_per_request ?? 0).toFixed(4)}`} />
          </div>
          <div className="h-80 rounded border border-slate-800 bg-slate-900 p-4">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 6 }} />
                <Legend />
                <Bar dataKey="calls" fill="#34d399" />
                <Bar dataKey="tokens" fill="#38bdf8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-slate-100">{value}</div>
    </div>
  );
}

export default function AgentConsole() {
  const location = useLocation();
  if (location.pathname === '/console') {
    return <SimulationConsole />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-base font-semibold text-slate-50">Buy-or-Wait Ops Dashboard</Link>
          <div className="flex items-center gap-4">
            <Link to="/console" className="text-sm text-slate-400 hover:text-slate-100">Simulation console</Link>
            <div className="inline-flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5" />
              API {API_BASE}
            </div>
          </div>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<RunsList />} />
        <Route path="/runs/:runId" element={<RunDetail />} />
      </Routes>
    </div>
  );
}
