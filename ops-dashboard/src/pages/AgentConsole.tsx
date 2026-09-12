import React, { useState, useEffect, useRef } from 'react';
import { Check, Loader2, Circle } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from 'recharts';

// Custom Theme Colors
const C = {
  ink: '#101720',
  panel: '#171F29',
  hairline: '#28323E',
  paper: '#E9E5DA',
  muted: '#8A93A3',
  dim: '#5B6472',
  green: '#4C9A82',
  amber: '#C99A3E',
  steel: '#5A7A9E',
  clay: '#B85C4C',
};

const STATUS: Record<string, { color: string; label: string }> = {
  affordable_now: { color: C.green, label: 'Affordable now' },
  affordable_with_plan: { color: C.amber, label: 'Affordable with a plan' },
  affordable_later: { color: C.steel, label: 'Affordable later' },
  not_affordable: { color: C.clay, label: 'Not affordable' },
};

// Types
interface ChartData { day: number; b: number; }
interface Stage { name: string; detail: string; chart?: boolean; }
interface PlanStep { date: string; amount: string; }
interface Decision {
  status: string;
  safeToPay: string;
  method: string;
  plan: PlanStep[];
  earliestFull: string;
  spendChange: string;
  explanation: string;
}
interface RequestData {
  id: string;
  user: string;
  type: string;
  amount: string;
  text: string;
  minBalance: number;
  stages: Stage[];
  decision: Decision;
  chartData: ChartData[];
}

const REQUESTS: RequestData[] = [
  {
    id: 'req_014',
    user: 'user_07',
    type: 'Purchase',
    amount: '₹42,000',
    text: 'Can I buy this laptop now?',
    minBalance: 15000,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 6 events, 2 payment options for req_014.' },
      { name: 'Resolve image', detail: 'event_031 amount was blank → read image_012 → ₹8,500 (high confidence).' },
      { name: 'Parse messages', detail: 'msg_0091 confirms rent delayed to the 18th → applied as amendment.' },
      { name: 'Reconstruct ledger', detail: 'Balance ₹51,200 · min balance ₹15,000 · 3 recurring, 1 flexible.' },
      { name: '90-day forecast', detail: 'Full payment today breaches the minimum once rent clears. Chart below.', chart: true },
      { name: 'Rank plans', detail: 'partial_payment completes the request sooner, with a lower total paid, than installments — selected.' },
      { name: 'Validate', detail: 'Schema checks passed.' },
    ],
    decision: {
      status: 'affordable_with_plan',
      safeToPay: '₹18,400',
      method: 'partial_payment',
      plan: [
        { date: '2026-09-12', amount: '₹18,400' },
        { date: '2026-10-03', amount: '₹23,600' },
      ],
      earliestFull: '2026-10-03',
      spendChange: 'reduce_to:event_044 → ₹2,000 (dining out)',
      explanation:
        'Paying the full amount today would drop the balance below the ₹15,000 minimum once rent clears. Splitting the payment across two dates, after the next salary lands, keeps the balance safe throughout.',
    },
    chartData: [
      { day: 0, b: 32800 },
      { day: 6, b: 24100 },
      { day: 12, b: 17600 },
      { day: 18, b: 41600 },
      { day: 21, b: 18000 },
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
    amount: '$2,400',
    text: 'Can I book this flight to Lisbon now?',
    minBalance: 1200,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 4 events, 0 payment options for req_027.' },
      { name: 'Resolve image', detail: 'No blank amounts linked to this request — skipped.' },
      { name: 'Parse messages', detail: 'No messages linked to req_027 — skipped.' },
      { name: 'Reconstruct ledger', detail: 'Balance $6,150 · min balance $1,200 · 2 recurring, none flexible.' },
      { name: '90-day forecast', detail: 'Paying $2,400 today keeps the balance above $2,900 for all 90 days.', chart: true },
      { name: 'Rank plans', detail: 'full_payment is the only eligible method and it is safe — selected.' },
      { name: 'Validate', detail: 'Schema checks passed.' },
    ],
    decision: {
      status: 'affordable_now',
      safeToPay: '$2,400',
      method: 'full_payment',
      plan: [{ date: '2026-09-12', amount: '$2,400' }],
      earliestFull: '2026-09-12',
      spendChange: 'none',
      explanation:
        'The full $2,400 is safe to pay today — the forecast never approaches the $1,200 minimum, even after the next two recurring bills clear.',
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
    amount: 'R18,000',
    text: 'Can I put down this deposit this week?',
    minBalance: 5000,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 7 events, 1 payment option for req_041.' },
      { name: 'Resolve image', detail: 'event_058 amount was blank → read image_027 → R3,200 (medium confidence).' },
      { name: 'Parse messages', detail: 'msg_0114 cancels a pending R9,000 freelance credit → excluded from the forecast.' },
      { name: 'Reconstruct ledger', detail: 'Balance R14,300 · min balance R5,000 · 4 recurring, 1 flexible.' },
      { name: '90-day forecast', detail: 'No day in the next 90 keeps an R18,000 payment above the minimum.', chart: true },
      { name: 'Rank plans', detail: 'No eligible method stays safe inside the forecast window.' },
      { name: 'Validate', detail: 'Schema checks passed.' },
    ],
    decision: {
      status: 'not_affordable',
      safeToPay: 'R6,100',
      method: 'not_recommended',
      plan: [],
      earliestFull: '—',
      spendChange: 'stop:event_071 (streaming subscriptions)',
      explanation:
        'Even after stopping flexible subscriptions, the deposit pushes the balance below the R5,000 minimum at every point in the forecast — the cancelled freelance credit removed the cushion this plan depended on.',
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
  {
    id: 'req_058',
    user: 'user_31',
    type: 'Education',
    amount: '€3,600',
    text: 'Can I pay this tuition deposit now, or should I wait?',
    minBalance: 800,
    stages: [
      { name: 'Retrieve context', detail: 'Loaded profile, 5 events, 2 payment options for req_058.' },
      { name: 'Resolve image', detail: 'No blank amounts linked to this request — skipped.' },
      { name: 'Parse messages', detail: 'msg_0142 confirms the salary date moved from the 25th to the 22nd → applied.' },
      { name: 'Reconstruct ledger', detail: 'Balance €1,900 · min balance €800 · 3 recurring, 1 flexible.' },
      { name: '90-day forecast', detail: 'Unsafe today; becomes safe once October salary lands on the 22nd.', chart: true },
      { name: 'Rank plans', detail: 'wait is the only eligible, safe method inside the desired date.' },
      { name: 'Validate', detail: 'Schema checks passed.' },
    ],
    decision: {
      status: 'affordable_later',
      safeToPay: '€740',
      method: 'wait',
      plan: [{ date: '2026-10-22', amount: '€3,600' }],
      earliestFull: '2026-10-22',
      spendChange: 'none',
      explanation:
        "Today's balance can't absorb the deposit without breaking the €800 minimum. It becomes safe right after the next salary lands on Oct 22 — comfortably ahead of the desired date.",
    },
    chartData: [
      { day: 0, b: 1900 },
      { day: 10, b: 1500 },
      { day: 20, b: 1150 },
      { day: 30, b: 950 },
      { day: 39, b: 900 },
      { day: 40, b: 1500 },
      { day: 55, b: 2100 },
      { day: 70, b: 1800 },
      { day: 90, b: 2400 },
    ],
  },
];

const RUN_STATS = { requests: 4, calls: 26, tokens: '6,180', cost: '$0.014' };

const BalanceChart: React.FC<{ data: ChartData[]; minBalance: number; color: string }> = ({ data, minBalance, color }) => {
  return (
    <div className="w-full h-[180px] animate-fade-in">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="day"
            tick={{ fill: C.dim, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
            axisLine={{ stroke: C.hairline }}
            tickLine={false}
            tickFormatter={(d) => `d${d}`}
          />
          <YAxis hide domain={['dataMin - 2000', 'dataMax + 2000']} />
          <ReferenceLine
            y={minBalance}
            stroke={C.clay}
            strokeDasharray="4 4"
            label={{ value: 'min balance', position: 'insideTopLeft', fill: C.clay, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Line
            type="monotone"
            dataKey="b"
            stroke={color}
            strokeWidth={2.5}
            dot={{ r: 3, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5, stroke: C.ink, strokeWidth: 2 }}
            animationDuration={800}
            animationEasing="ease-out"
          />
          <Tooltip
            contentStyle={{
              background: C.panel,
              border: `1px solid ${C.hairline}`,
              borderRadius: '6px',
              fontSize: '12px',
              fontFamily: 'IBM Plex Mono, monospace',
              color: C.paper,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
            }}
            itemStyle={{ color: C.paper }}
            labelFormatter={(d) => `day ${d}`}
            formatter={(v: number) => [v.toLocaleString(), 'balance']}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const StageRow: React.FC<{ stage: Stage; state: 'pending'|'active'|'done'; color: string; minBalance: number; chartColor: string; chartData: ChartData[]; isLast: boolean }> = ({ stage, state, color, minBalance, chartColor, chartData, isLast }) => {
  return (
    <div className={`flex gap-4 transition-opacity duration-500 ${state === 'pending' ? 'opacity-40' : 'opacity-100'}`}>
      <div className="flex flex-col items-center">
        <div
          className="flex items-center justify-center rounded-full transition-colors duration-300"
          style={{
            width: 24,
            height: 24,
            border: `1.5px solid ${state === 'pending' ? C.hairline : color}`,
            color: state === 'pending' ? C.dim : color,
            flexShrink: 0,
            background: state === 'active' ? `${color}15` : 'transparent',
          }}
        >
          {state === 'done' && <Check size={14} strokeWidth={2.5} />}
          {state === 'active' && <Loader2 size={14} className="animate-spin text-current" />}
          {state === 'pending' && <Circle size={8} fill={C.dim} stroke="none" />}
        </div>
        {!isLast && (
          <div className="w-[1.5px] flex-1 min-h-[16px] my-1" style={{ background: state === 'done' ? color : C.hairline, opacity: state === 'done' ? 0.3 : 1 }} />
        )}
      </div>
      <div className="pb-6 flex-1 min-w-0">
        <div
          className="text-[15px] transition-colors duration-300"
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontWeight: 500,
            color: state === 'pending' ? C.dim : C.paper,
          }}
        >
          {stage.name}
        </div>
        {state !== 'pending' && (
          <p
            className="mt-1.5 text-[13px] leading-relaxed tracking-wide animate-fade-in"
            style={{ fontFamily: 'IBM Plex Mono, monospace', color: C.muted, maxWidth: '52ch' }}
          >
            {stage.detail}
          </p>
        )}
        {state === 'done' && stage.chart && (
          <div className="mt-4 rounded-md p-3 bg-black/20" style={{ border: `1px solid ${C.hairline}` }}>
            <BalanceChart
              data={chartData}
              minBalance={minBalance}
              color={chartColor}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const DecisionPanel: React.FC<{ request: RequestData; ready: boolean }> = ({ request, ready }) => {
  const d = request.decision;
  const s = STATUS[d.status];
  
  return (
    <div
      className="rounded-lg p-6 md:p-8 transition-all duration-700 ease-out"
      style={{
        background: C.panel,
        border: `1px solid ${C.hairline}`,
        borderLeft: `4px solid ${ready ? s.color : C.hairline}`,
        minHeight: '320px',
        boxShadow: ready ? `0 8px 24px -4px ${s.color}20` : 'none',
      }}
    >
      <div
        className="text-xs uppercase tracking-widest mb-6"
        style={{ fontFamily: 'Space Grotesk, sans-serif', color: C.dim, fontWeight: 600 }}
      >
        Final Decision
      </div>

      {!ready ? (
        <div className="flex flex-col items-center justify-center h-48 space-y-4">
          <Loader2 size={24} className="animate-spin" style={{ color: C.dim }} />
          <div className="text-sm" style={{ color: C.dim, fontFamily: 'IBM Plex Mono, monospace' }}>
            Pipeline evaluating constraints…
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          <div>
            <div
              className="inline-flex items-center text-sm px-3 py-1.5 rounded-full"
              style={{ color: s.color, border: `1px solid ${s.color}40`, background: `${s.color}10`, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600 }}
            >
              {s.label}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-y-4 gap-x-6 text-[13px]" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
            <div>
              <dt style={{ color: C.dim, marginBottom: '2px' }}>Safe to pay</dt>
              <dd style={{ color: C.paper, fontWeight: 500, fontSize: '15px' }}>{d.safeToPay}</dd>
            </div>
            <div>
              <dt style={{ color: C.dim, marginBottom: '2px' }}>Method</dt>
              <dd style={{ color: C.paper, fontWeight: 500 }}>{d.method.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt style={{ color: C.dim, marginBottom: '2px' }}>Earliest full payment</dt>
              <dd style={{ color: C.paper }}>{d.earliestFull}</dd>
            </div>
            <div>
              <dt style={{ color: C.dim, marginBottom: '2px' }}>Spending change</dt>
              <dd style={{ color: C.amber }}>{d.spendChange}</dd>
            </div>
          </dl>

          <div className="pt-4 border-t" style={{ borderColor: C.hairline }}>
            <div className="text-[13px] mb-3" style={{ color: C.dim, fontFamily: 'IBM Plex Mono, monospace' }}>
              Payment Schedule
            </div>
            {d.plan.length === 0 ? (
              <div className="text-[13px] py-2 px-3 rounded bg-black/20" style={{ color: C.muted, fontFamily: 'IBM Plex Mono, monospace', border: `1px solid ${C.hairline}` }}>
                No payment recommended
              </div>
            ) : (
              <div className="text-[13px] rounded bg-black/20 overflow-hidden" style={{ fontFamily: 'IBM Plex Mono, monospace', border: `1px solid ${C.hairline}` }}>
                {d.plan.map((p, i) => (
                  <div key={i} className="flex justify-between py-2 px-3" style={{ borderBottom: i === d.plan.length - 1 ? 'none' : `1px solid ${C.hairline}` }}>
                    <span style={{ color: C.muted }}>{p.date}</span>
                    <span style={{ color: C.paper, fontWeight: 500 }}>{p.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4">
            <p className="text-[15px] leading-relaxed" style={{ fontFamily: 'Space Grotesk, sans-serif', color: C.paper, fontWeight: 300 }}>
              {d.explanation}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default function BuyOrWaitConsole() {
  const [activeId, setActiveId] = useState(REQUESTS[0].id);
  const [revealed, setRevealed] = useState(0);
  const timerRef = useRef<number | null>(null);
  
  const active = REQUESTS.find((r) => r.id === activeId)!;

  useEffect(() => {
    setRevealed(0);
    let count = 0;
    
    // Slight initial delay before starting the pipeline
    const startDelay = setTimeout(() => {
      timerRef.current = window.setInterval(() => {
        count += 1;
        setRevealed(count);
        if (count >= active.stages.length) {
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }, 400); // Slower, more readable pace
    }, 300);

    return () => {
      clearTimeout(startDelay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeId]);

  const allDone = revealed >= active.stages.length;
  const statusColor = STATUS[active.decision.status].color;

  return (
    <div
      className="min-h-screen w-full flex justify-center py-10 px-4 sm:px-6 lg:px-8 transition-colors duration-500"
      style={{ background: '#0B0F15' }} // slightly darker than ink for the outer body
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Custom scrollbar for horizontal lists */
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div 
        className="w-full max-w-6xl rounded-2xl p-6 md:p-10 shadow-2xl"
        style={{ background: C.ink, border: `1px solid ${C.hairline}` }}
      >
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8" style={{ borderBottom: `1px solid ${C.hairline}` }}>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs tracking-widest uppercase font-semibold" style={{ color: C.muted, fontFamily: 'IBM Plex Mono, monospace' }}>Live Agent System</span>
            </div>
            <h1 className="text-3xl" style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, color: C.paper, letterSpacing: '-0.02em' }}>
              Buy or Wait Console
            </h1>
            <p className="text-[15px] mt-2" style={{ color: C.muted, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 300, maxWidth: '58ch' }}>
              A deterministic affordability orchestrator. The LLM extracts data, while the pipeline enforces rigorous math and rules.
            </p>
          </div>
          
          <div className="flex flex-wrap gap-6 text-[13px] bg-black/20 p-4 rounded-xl border" style={{ fontFamily: 'IBM Plex Mono, monospace', borderColor: C.hairline }}>
            {[
              ['Requests Run', RUN_STATS.requests],
              ['Tool Calls', RUN_STATS.calls],
              ['Tokens Used', RUN_STATS.tokens],
              ['Est. Cost', RUN_STATS.cost],
            ].map(([label, val], i) => (
              <div key={i} className="flex flex-col" style={{ borderLeft: i === 0 ? 'none' : `1px solid ${C.hairline}`, paddingLeft: i === 0 ? 0 : '24px' }}>
                <span style={{ color: C.dim, marginBottom: '4px' }}>{label}</span>
                <span style={{ color: C.paper, fontSize: '16px', fontWeight: 500 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Request selector */}
        <div className="py-8">
          <div className="text-[13px] uppercase tracking-widest mb-4 font-semibold" style={{ color: C.dim, fontFamily: 'Space Grotesk, sans-serif' }}>
            Select Request Context
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar snap-x">
            {REQUESTS.map((r) => {
              const isActive = r.id === activeId;
              const sColor = STATUS[r.decision.status].color;
              return (
                <button
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className="snap-start flex-shrink-0 text-left p-4 rounded-xl transition-all duration-300 relative group"
                  style={{
                    background: isActive ? C.panel : 'transparent',
                    border: `1px solid ${isActive ? sColor : C.hairline}`,
                    minWidth: '220px',
                    boxShadow: isActive ? `0 4px 12px -2px ${sColor}30` : 'none',
                  }}
                >
                  {/* Hover effect border */}
                  {!isActive && <div className="absolute inset-0 rounded-xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>}
                  
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="text-[13px] font-medium" style={{ color: isActive ? sColor : C.dim, fontFamily: 'IBM Plex Mono, monospace' }}>
                      {r.id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: isActive ? `${sColor}20` : C.hairline, color: isActive ? sColor : C.muted, fontFamily: 'Space Grotesk, sans-serif' }}>
                      {r.type}
                    </span>
                  </div>
                  <div className="text-xl font-medium mb-1" style={{ color: C.paper, fontFamily: 'IBM Plex Mono, monospace' }}>
                    {r.amount}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="inline-flex mt-2 items-center gap-3 px-4 py-3 rounded-lg" style={{ background: `${C.panel}80`, border: `1px solid ${C.hairline}` }}>
             <span style={{ color: C.steel }}>💬</span>
             <p className="text-[15px] italic" style={{ color: C.paper, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 300 }}>
              "{active.text}"
            </p>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 pt-8" style={{ borderTop: `1px solid ${C.hairline}` }}>
          
          {/* Pipeline Left Column */}
          <div className="lg:col-span-3">
            <div className="text-[13px] uppercase tracking-widest mb-8 font-semibold flex items-center gap-2" style={{ color: C.dim, fontFamily: 'Space Grotesk, sans-serif' }}>
              <Loader2 size={14} className={allDone ? '' : 'animate-spin'} style={{ color: allDone ? C.green : C.steel }} />
              Pipeline Execution Steps
            </div>
            <div className="space-y-2 relative">
              {/* Vertical connecting line for all stages */}
              <div className="absolute left-[11.5px] top-4 bottom-8 w-[1.5px]" style={{ background: C.hairline, zIndex: 0 }}></div>
              
              {active.stages.map((stage, i) => {
                const state = i < revealed ? 'done' : i === revealed ? 'active' : 'pending';
                return (
                  <div key={stage.name} className="relative z-10">
                    <StageRow
                      stage={stage}
                      state={state}
                      color={statusColor}
                      minBalance={active.minBalance}
                      chartColor={statusColor}
                      chartData={active.chartData}
                      isLast={i === active.stages.length - 1}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Decision Right Column */}
          <div className="lg:col-span-2 relative">
            <div className="sticky top-8">
               <DecisionPanel request={active} ready={allDone} />
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
