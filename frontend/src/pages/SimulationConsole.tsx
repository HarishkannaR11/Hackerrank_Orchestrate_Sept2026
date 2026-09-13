import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Circle, Loader2, Table2 } from 'lucide-react';
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const C = {
  ink: '#0f1720',
  panel: '#141d28',
  panelSoft: '#192433',
  hairline: '#2b3746',
  paper: '#f4efe3',
  muted: '#9aa7b8',
  dim: '#687589',
  green: '#54b894',
  amber: '#d3a33f',
  blue: '#6aa3d8',
  red: '#d66a5a',
};

type Status = 'affordable_now' | 'affordable_with_plan' | 'affordable_later' | 'not_affordable';

const STATUS: Record<Status, { color: string; label: string }> = {
  affordable_now: { color: C.green, label: 'Affordable now' },
  affordable_with_plan: { color: C.amber, label: 'Affordable with a plan' },
  affordable_later: { color: C.blue, label: 'Affordable later' },
  not_affordable: { color: C.red, label: 'Not affordable' },
};

const REQUESTS = [
  {
    id: 'req_014',
    user: 'user_07',
    type: 'Purchase',
    amount: 'INR 42,000',
    text: 'Can I buy this laptop now?',
    minBalance: 15000,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 6 events, and 2 payment options for req_014.' },
      { name: 'Resolve image', detail: 'event_031 amount was blank, image_012 resolved INR 8,500 with high confidence.' },
      { name: 'Parse messages', detail: 'msg_0091 confirms rent moved to the 18th and was applied as an amendment.' },
      { name: 'Reconstruct ledger', detail: 'Balance INR 51,200, minimum INR 15,000, 3 recurring events, 1 flexible.' },
      { name: '90-day forecast', detail: 'Full payment today breaches the minimum once rent clears.', chart: true },
      { name: 'Rank plans', detail: 'partial_payment completes sooner with lower total paid than installments.' },
      { name: 'Validate', detail: 'Schema and safety checks passed.' },
    ],
    decision: {
      status: 'affordable_with_plan' as Status,
      safeToPay: 'INR 18,400',
      method: 'partial_payment',
      plan: [
        { date: '2026-09-12', amount: 'INR 18,400' },
        { date: '2026-10-03', amount: 'INR 23,600' },
      ],
      earliestFull: '2026-10-03',
      spendChange: 'reduce_to:event_044:2000',
      explanation:
        'Paying the full amount today would drop below the INR 15,000 minimum once rent clears. Splitting the payment keeps the balance protected after salary lands.',
    },
    chartData: [
      { day: 0, b: 32800 },
      { day: 6, b: 24100 },
      { day: 12, b: 17600 },
      { day: 18, b: 41600 },
      { day: 30, b: 22500 },
      { day: 45, b: 27800 },
      { day: 60, b: 31200 },
      { day: 75, b: 26400 },
      { day: 90, b: 29800 },
    ],
  },
  {
    id: 'req_027',
    user: 'user_12',
    type: 'Travel',
    amount: 'USD 2,400',
    text: 'Can I book this flight to Lisbon now?',
    minBalance: 1200,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 4 events, and no installment options for req_027.' },
      { name: 'Resolve image', detail: 'No blank amounts linked to this request.' },
      { name: 'Parse messages', detail: 'No messages linked to this request.' },
      { name: 'Reconstruct ledger', detail: 'Balance USD 6,150, minimum USD 1,200, 2 recurring events.' },
      { name: '90-day forecast', detail: 'Paying USD 2,400 today stays safely above the minimum.', chart: true },
      { name: 'Rank plans', detail: 'full_payment is eligible and safe.' },
      { name: 'Validate', detail: 'Schema and safety checks passed.' },
    ],
    decision: {
      status: 'affordable_now' as Status,
      safeToPay: 'USD 2,400',
      method: 'full_payment',
      plan: [{ date: '2026-09-12', amount: 'USD 2,400' }],
      earliestFull: '2026-09-12',
      spendChange: 'none',
      explanation:
        'The full payment is safe today. The forecast never approaches the USD 1,200 minimum after recurring bills clear.',
    },
    chartData: [
      { day: 0, b: 3750 },
      { day: 10, b: 3400 },
      { day: 20, b: 2950 },
      { day: 30, b: 4900 },
      { day: 45, b: 4200 },
      { day: 60, b: 3800 },
      { day: 75, b: 4600 },
      { day: 90, b: 4100 },
    ],
  },
  {
    id: 'req_041',
    user: 'user_23',
    type: 'Housing',
    amount: 'ZAR 18,000',
    text: 'Can I put down this deposit this week?',
    minBalance: 5000,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 7 events, and 1 payment option for req_041.' },
      { name: 'Resolve image', detail: 'event_058 amount was resolved from image_027 with medium confidence.' },
      { name: 'Parse messages', detail: 'msg_0114 cancels a pending freelance credit, so it was excluded.' },
      { name: 'Reconstruct ledger', detail: 'Balance ZAR 14,300, minimum ZAR 5,000, 4 recurring events.' },
      { name: '90-day forecast', detail: 'No full deposit date stays above the minimum in the 90-day window.', chart: true },
      { name: 'Rank plans', detail: 'No eligible method remains safe.' },
      { name: 'Validate', detail: 'Schema and safety checks passed.' },
    ],
    decision: {
      status: 'not_affordable' as Status,
      safeToPay: 'ZAR 6,100',
      method: 'not_recommended',
      plan: [],
      earliestFull: 'No safe date found',
      spendChange: 'stop:event_071',
      explanation:
        'Even after stopping flexible subscriptions, the deposit pushes the balance below the ZAR 5,000 minimum.',
    },
    chartData: [
      { day: 0, b: 14300 },
      { day: 10, b: 9800 },
      { day: 20, b: 7200 },
      { day: 30, b: 5900 },
      { day: 45, b: 6400 },
      { day: 60, b: 5100 },
      { day: 75, b: 6800 },
      { day: 90, b: 5900 },
    ],
  },
];

const RUN_STATS = [
  ['Requests run', '3'],
  ['Tool calls', '26'],
  ['Tokens', '6,180'],
  ['Est. cost', '$0.014'],
];

function BalanceChart({ data, minBalance, color }: { data: Array<{ day: number; b: number }>; minBalance: number; color: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 18, right: 18, bottom: 4, left: 0 }}>
          <XAxis dataKey="day" tick={{ fill: C.dim, fontSize: 11 }} axisLine={{ stroke: C.hairline }} tickLine={false} tickFormatter={(d) => `d${d}`} />
          <YAxis hide domain={['dataMin - 2000', 'dataMax + 2000']} />
          <ReferenceLine y={minBalance} stroke={C.red} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="b" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          <Tooltip
            contentStyle={{ background: C.panel, border: `1px solid ${C.hairline}`, borderRadius: 6, color: C.paper }}
            labelFormatter={(d) => `day ${d}`}
            formatter={(v) => [v, 'balance']}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StageRow({ stage, state, color, isLast }: { stage: (typeof REQUESTS)[number]['stages'][number]; state: string; color: string; isLast: boolean }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border" style={{ borderColor: state === 'pending' ? C.hairline : color, color }}>
          {state === 'done' && <Check size={15} />}
          {state === 'active' && <Loader2 size={15} className="animate-spin" />}
          {state === 'pending' && <Circle size={7} fill={C.dim} stroke="none" />}
        </div>
        {!isLast && <div className="min-h-8 w-px flex-1" style={{ background: C.hairline }} />}
      </div>
      <div className="pb-6">
        <div className="text-sm font-semibold" style={{ color: state === 'pending' ? C.dim : C.paper }}>{stage.name}</div>
        {state !== 'pending' && <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: C.muted }}>{stage.detail}</p>}
      </div>
    </div>
  );
}

export default function SimulationConsole() {
  const [activeId, setActiveId] = useState(REQUESTS[0].id);
  const [revealed, setRevealed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const active = useMemo(() => REQUESTS.find((r) => r.id === activeId) ?? REQUESTS[0], [activeId]);
  const status = STATUS[active.decision.status];
  const allDone = revealed >= active.stages.length;

  useEffect(() => {
    let count = 0;
    timerRef.current = window.setInterval(() => {
      count += 1;
      setRevealed(count);
      if (count >= active.stages.length && timerRef.current) window.clearInterval(timerRef.current);
    }, 300);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [active]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b10] px-4 py-6 text-slate-100 sm:px-6 lg:px-8 font-sans">
      {/* Decorative Background Blobs */}
      <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-[120px] animate-blob pointer-events-none"></div>
      <div className="absolute top-[20%] right-[-10%] h-[600px] w-[600px] rounded-full bg-sky-500/10 blur-[120px] animate-blob pointer-events-none" style={{ animationDelay: '2s' }}></div>
      <div className="absolute bottom-[-20%] left-[20%] h-[700px] w-[700px] rounded-full bg-purple-500/10 blur-[150px] animate-blob pointer-events-none" style={{ animationDelay: '4s' }}></div>

      <div className="relative mx-auto max-w-7xl animate-fade-in-up rounded-xl border border-slate-800/60 bg-[#0f1720]/70 backdrop-blur-2xl shadow-2xl">
        <header className="flex flex-col gap-5 border-b border-slate-800/60 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 font-display text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: C.green }}>Live agent system</div>
            <h1 className="font-display text-3xl font-semibold tracking-normal" style={{ color: C.paper }}>Buy or Wait Console</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: C.muted }}>
              A compact simulation view of the deterministic affordability pipeline and final recommendation trace.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RUN_STATS.map(([label, value]) => (
              <div key={label} className="rounded-md border border-slate-800 bg-[#111b27] px-4 py-3">
                <div className="text-xs" style={{ color: C.dim }}>{label}</div>
                <div className="mt-1 font-mono text-base" style={{ color: C.paper }}>{value}</div>
              </div>
            ))}
          </div>
        </header>

        <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-100">
            <Table2 size={16} />
            Ops dashboard
          </Link>
          <span className="text-xs text-slate-500">Simulation data</span>
        </nav>

        <section className="border-b border-slate-800 px-6 py-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: C.dim }}>Select request</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {REQUESTS.map((request) => {
              const isActive = request.id === activeId;
              const requestStatus = STATUS[request.decision.status];
              return (
                <button
                  key={request.id}
                  onClick={() => {
                    setActiveId(request.id);
                    setRevealed(0);
                  }}
                  className={`group relative overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl ${isActive ? 'shadow-lg' : ''}`}
                  style={{ 
                    borderColor: isActive ? requestStatus.color : C.hairline, 
                    background: isActive ? `${C.panelSoft}cc` : 'transparent',
                    boxShadow: isActive ? `0 10px 30px -10px ${requestStatus.color}40` : undefined
                  }}
                >
                  {isActive && <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ background: `linear-gradient(135deg, transparent, ${requestStatus.color})` }} />}
                  <div className="relative z-10 flex items-center justify-between gap-4">
                    <span className="font-mono text-xs" style={{ color: C.dim }}>{request.id}</span>
                    <span className="text-xs" style={{ color: requestStatus.color }}>{request.type}</span>
                  </div>
                  <div className="mt-2 font-mono text-lg" style={{ color: C.paper }}>{request.amount}</div>
                  <div className="mt-1 truncate text-sm" style={{ color: C.muted }}>{request.text}</div>
                </button>
              );
            })}
          </div>
        </section>

        <main className="grid gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <section>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest" style={{ color: C.dim }}>Pipeline</div>
                <p className="mt-1 text-sm italic" style={{ color: C.muted }}>"{active.text}"</p>
              </div>
              {!allDone && <Loader2 className="h-5 w-5 animate-spin" style={{ color: status.color }} />}
            </div>
            {active.stages.map((stage, index) => {
              const state = index < revealed ? 'done' : index === revealed ? 'active' : 'pending';
              return <StageRow key={stage.name} stage={stage} state={state} color={status.color} isLast={index === active.stages.length - 1} />;
            })}
            {allDone && active.stages.some((stage) => stage.chart) && (
              <div className="mt-2 rounded-md border border-slate-800 bg-[#101925] p-4">
                <BalanceChart data={active.chartData} minBalance={active.minBalance} color={status.color} />
              </div>
            )}
          </section>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-slate-800/60 bg-[#141d28]/70 backdrop-blur-xl p-6 shadow-xl transition-all duration-300">
              <div className="mb-5 font-display text-xs font-bold uppercase tracking-widest" style={{ color: C.dim }}>Decision</div>
              {!allDone ? (
                <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-[#101925] p-4 text-sm" style={{ color: C.muted }}>
                  <Loader2 size={16} className="animate-spin" />
                  Waiting on pipeline stages
                </div>
              ) : (
                <div className="space-y-5">
                  <span className="inline-flex rounded-md border px-3 py-1.5 text-sm font-semibold" style={{ color: status.color, borderColor: status.color }}>
                    {status.label}
                  </span>
                  <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-3 text-sm">
                    <dt style={{ color: C.dim }}>Safe to pay</dt>
                    <dd className="font-mono" style={{ color: C.paper }}>{active.decision.safeToPay}</dd>
                    <dt style={{ color: C.dim }}>Method</dt>
                    <dd className="font-mono" style={{ color: C.paper }}>{active.decision.method}</dd>
                    <dt style={{ color: C.dim }}>Earliest full</dt>
                    <dd className="font-mono" style={{ color: C.paper }}>{active.decision.earliestFull}</dd>
                    <dt style={{ color: C.dim }}>Spending change</dt>
                    <dd className="font-mono" style={{ color: C.paper }}>{active.decision.spendChange}</dd>
                  </dl>
                  <div>
                    <div className="mb-2 text-xs uppercase tracking-widest" style={{ color: C.dim }}>Payment plan</div>
                    {active.decision.plan.length === 0 ? (
                      <div className="rounded-md border border-slate-800 bg-[#101925] p-3 text-sm" style={{ color: C.muted }}>No payment recommended</div>
                    ) : (
                      <div className="overflow-hidden rounded-md border border-slate-800">
                        {active.decision.plan.map((step) => (
                          <div key={`${step.date}-${step.amount}`} className="flex justify-between border-b border-slate-800 px-3 py-2 last:border-b-0">
                            <span className="font-mono text-sm" style={{ color: C.muted }}>{step.date}</span>
                            <span className="font-mono text-sm" style={{ color: C.paper }}>{step.amount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="border-t border-slate-800 pt-4 text-sm leading-6" style={{ color: C.paper }}>{active.decision.explanation}</p>
                </div>
              )}
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
