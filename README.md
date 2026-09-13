# Buy or Wait? — Financial Affordability Agent

An AI-powered financial agent that decides whether a user can safely afford a
requested expense — full payment, partial payment, installments, wait, or not
at all — personalized to each user's balance, commitments, priorities, and
payment preferences.

Built for the **HackerRank Orchestrate** 24-hour hackathon (September 2026).
Full task spec, schema, and rules: [`problem_statement.md`](./problem_statement.md).

---

## Our Approach

We built this as a **hybrid deterministic-core / multi-agent system**,
orchestrated with **LangGraph** and traced with **LangSmith**, using **Groq**
(via `langchain-groq`) for the LLM calls.

**Why hybrid, not end-to-end agentic:** the graded fields (`amount_safe_to_pay`,
`affordability_status`, the ranking tiebreak, the 90-day safety check) are
exact, reproducible numeric/date rules. An LLM is unreliable at that kind of
arithmetic and its output isn't guaranteed reproducible run to run. So the
numeric core stays in plain deterministic Python (`backend/main.py`), and
LangGraph orchestrates only the three places genuine unstructured-data
reasoning is required: reading receipt/screenshot images, interpreting
messages, and writing the final explanation.

### Two LangGraph graphs (`backend/graph.py`)

**1. Ledger reconstruction graph** — runs once per user:

```
load context → image agent (conditional) → message agent (conditional) → apply deltas
```

- **Image agent** — reads a linked receipt/screenshot PNG to fill in a blank
  `amount` on a financial event (vision LLM call).
- **Message agent** — parses a message linked to a financial event into a
  structured delta: `cancel | amend | delay | confirm | clarify | no_op`.
- Both are skipped via conditional edges when a user has no blank amounts or
  no linked messages, so cost tracks actual ambiguity in the data rather than
  running on every user regardless.
- Both treat their input as **untrusted data**: a regex guard
  (`backend/injection_guard.py`) plus explicit prompt instructions stop
  embedded "ignore previous instructions"-style text from being followed.
  Anything low-confidence or flagged is never silently applied — it's queued
  in a **review queue** surfaced in the dashboard for a human to accept or
  override.

**2. Decision graph** — runs once per request:

```
compute (deterministic forecast → candidates → rank) → explain (LLM) → validate
```

- `compute` reuses `backend/main.py`'s forecast, candidate generation, and the
  spec's 6-level ranking tiebreak — untouched by any LLM.
- `explain` asks an LLM to rewrite the deterministic explanation in clearer
  prose. A grounding check rejects the rewrite — falling back to the
  deterministic text — if it drops any required number or currency, so the
  explanation can never invent a fact.
- `validate` re-checks the row against the spec's bounds/schema rules. On
  failure it falls back to the plain deterministic decision (zero LLM
  influence), which is guaranteed to validate.

### Efficiency

- Every LLM call (image, message, explanation) is cached in
  `backend/extraction_cache.sqlite`, keyed by item id (explanations also key
  on a content hash), so re-running the pipeline after a code change doesn't
  re-spend tokens on unaffected requests.
- `evaluation/usage_report.md` is generated from real, tracked token counts of
  the run that produced `output.csv` — not estimated after the fact.

### Known limitation

The available Groq API key/plan does not currently expose a vision-capable
model (confirmed via `client.models.list()` — text-only models only). Blank
`amount` events whose image can't be read are left blank rather than guessed
(per the spec's "never treat a blank amount as zero" rule) and surfaced in
the review queue for manual resolution. Swap `GROQ_VISION_MODEL` in
`backend/llm_agents.py` once a vision model is available on the account.

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure API keys

Create/edit `backend/.env`:

```bash
GROQ_API=your_groq_api_key_here          # required — powers the LLM agents
LANGSMITH_API_KEY=your_langsmith_key     # optional — enables LangGraph run tracing
```

Without `GROQ_API`, the pipeline still runs end-to-end and produces a fully
valid `output.csv` — the LLM agents no-op and the deterministic engine's own
values/text are used instead. Without `LANGSMITH_API_KEY`, everything runs
identically; you just don't get traces at
[smith.langchain.com](https://smith.langchain.com).

### 3. Generate `output.csv` (the graded artifact)

```bash
python -m backend.graph
```

Runs the full multi-agent pipeline against every row in
`dataset/requests.csv`, writes `output.csv` to the repo root, and writes
`evaluation/usage_report.md` summarizing the real token usage/cost of that run.

A pure-deterministic fallback (no LLM calls, no `.env` needed) is also
available:

```bash
python backend/main.py
```

### 4. (Optional) Run the ops dashboard

Two processes, in separate terminals:

```bash
# Terminal 1 — API server
uvicorn backend.api:app --reload --port 8123

# Terminal 2 — React dashboard
cd frontend
npm install
VITE_API_BASE_URL=http://127.0.0.1:8123 npm run dev
```

Open the printed Vite URL and click **Start new run** to watch the pipeline
execute live: an output table, a review queue (low-confidence or
injection-flagged extractions needing human sign-off), and a usage report.

---

## Repository Layout

```text
backend/
  main.py                   Deterministic engine: forecast, candidates, ranking, validation.
  graph.py                  LangGraph orchestration (ledger graph + decision graph).
  llm_agents.py             The 3 LLM agents (image extraction, message parsing, explanation).
  injection_guard.py        Regex guard against prompt injection in untrusted content.
  usage_tracker.py          Real per-model token/cost tracking -> evaluation/usage_report.md.
  extraction_cache.py       SQLite cache so repeated runs don't re-spend LLM tokens.
  api.py                    FastAPI wrapper around graph.py, for the ops dashboard.
  .env                      GROQ_API / LANGSMITH_API_KEY (not committed).
frontend/                   React/Vite operations dashboard (talks to backend/api.py).
code/main.py                Compatibility launcher for `python3 code/main.py`.
dataset/                    Provided input data (do not modify) — see below.
requirements.txt            Python dependencies (langgraph, langsmith, langchain-groq, ...).
output.csv                  Final generated predictions (repo root).
evaluation/usage_report.md  Token usage & cost report for the run that produced output.csv.
problem_statement.md        Full challenge spec.
```

---

## Dataset Reference

Only `dataset/requests.csv` requires predictions. Everything else is context,
joined via `user_id` (user-level), `request_id` (request-level), and
`related_event_id` (message/image → financial event). Exchange rates join on
rate date + currency pair. Full details in
[`problem_statement.md`](./problem_statement.md).

```text
dataset/
├── requests.csv                  250 requests to evaluate — predict these
├── output.csv                    Blank submission template
├── sample_requests.csv           25 solved examples (expected format/style)
├── financial_profiles.csv        Balances, minimum balance, priorities, preferences
├── financial_events.csv          Historical, pending, and confirmed transactions
├── request_payment_options.csv   Payment options available per request
├── exchange_rates.csv            Fixed, dated conversion rates
├── messages.csv                  Messages tied to users, requests, or events
├── images.csv                    Payroll letters, statements, bills, receipts
└── media/images/                 PNGs referenced by images.csv
```

Amounts are in the user's `home_currency` (INR, ZAR, IDR, USD, EUR); every
conversion rate needed is in `exchange_rates.csv`. All dates are `YYYY-MM-DD`.
Live exchange rates, market data, and banking access are not required.

---

## Output Schema

For every row in `dataset/requests.csv`, one row in `output.csv`:

| Column | Meaning |
|---|---|
| `request_id` | The request being answered |
| `amount_safe_to_pay` | Largest amount safe to pay on `request_date` before optional spending changes, after protecting essentials and the minimum balance |
| `affordability_status` | `affordable_now`, `affordable_with_plan`, `affordable_later`, or `not_affordable` |
| `recommended_payment_method` | `full_payment`, `partial_payment`, `installments`, `wait`, or `not_recommended` |
| `payment_plan` | Chronological `<YYYY-MM-DD>:<amount>` entries joined by `\|`, or `none` |
| `earliest_date_for_full_payment` | Earliest date the full amount is forecast safe as one payment; empty if never within the forecast |
| `spending_changes_needed` | Up to three `stop:<event_id>` / `reduce_to:<event_id>:<amount>` changes joined by `\|`, or `none` |
| `decision_explanation` | Short explanation and the financial facts behind it |

`0 <= amount_safe_to_pay <= requested_amount` always holds. Installment plans
must exactly match a supplied payment option; only recurring expenses marked
flexible may be changed.

`affordable_with_plan` means the full request completes via a partial-payment
schedule, installments, or permitted spending changes. `partial_payment`
requires: the request allows it, the user accepts it,
`0 < amount_safe_to_pay < requested_amount`, and `earliest_date_for_full_payment`
on or before `desired_completion_date` — exactly two payments (today's safe
amount, then the remainder on the earliest safe date), summing to
`requested_amount`. Unlike installments, it doesn't need to match a supplied
payment option.

---

## Evaluation

`output.csv` is compared against hidden ground truth on: accuracy of
`amount_safe_to_pay`, correctness of `affordability_status`,
`recommended_payment_method` and `payment_plan`, accuracy of
`earliest_date_for_full_payment`, validity of `spending_changes_needed`, and
usefulness/consistency of `decision_explanation`.

---

## Chat Transcript Logging

[`AGENTS.md`](./AGENTS.md) asks compatible AI coding tools to append
conversation summaries to `log.txt` in the repository root (same directory as
`AGENTS.md`, so the path resolves correctly across clones/renames). `log.txt`
is gitignored — upload it as the `chat_transcript` submission artifact. Don't
paste secrets into the chat.

---

## Submission Checklist

| File | Description |
|---|---|
| `code.zip` | This full runnable solution, including `README.md` and `evaluation/usage_report.md` |
| `output.csv` | Predictions for every row in `dataset/requests.csv` |
| `chat_transcript` | The `log.txt` described above |

Before submitting, confirm:

- [ ] `output.csv` has one row per row in `dataset/requests.csv` (250 rows + header), in the exact required column order.
- [ ] Every `amount_safe_to_pay` satisfies `0 <= amount_safe_to_pay <= requested_amount`.
- [ ] Every installment plan matches a supplied payment option; every spending change targets a flexible recurring expense.
- [ ] `evaluation/usage_report.md` reflects the actual final run that produced `output.csv`.
- [ ] No API keys or secrets are present anywhere in `code.zip` (`backend/.env` is gitignored — verify it isn't accidentally included).
