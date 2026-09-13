# HackerRank Orchestrate

Starter repository for the **HackerRank Orchestrate** 24-hour hackathon (September 2026).

## Buy or Wait?

Build an AI-powered financial agent that decides whether a user can safely afford a requested expense.

A user may ask: **"Can I afford this laptop?"**

Answering well takes more than the current balance. The agent must account for recurring expenses, pending payments, essential spending, confirmed income, available payment options, and relevant details buried in messages and images.

For every request, the agent decides whether the user should pay in full, pay partially, use installments, wait, or not proceed. The recommendation must be personalized: two users with the same balance can deserve different answers based on their commitments, priorities, payment preferences, and willingness to adjust flexible expenses.

A recommendation is safe only if the user can complete the full payment plan, cover essential expenses, and stay above their preferred minimum balance throughout the forecast period.

Read [`problem_statement.md`](./problem_statement.md) for the full task spec, input/output schema, allowed values, conflict-resolution rules, and submission format.

---

## Our Solution — Setup

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

Without `GROQ_API`, the pipeline still runs end-to-end and produces a fully valid
`output.csv` — the LLM agents (image extraction, message parsing, explanation
rewriting) just no-op and the deterministic engine's own text/values are used
instead. Without `LANGSMITH_API_KEY`, everything runs identically; you just don't
get traces at [smith.langchain.com](https://smith.langchain.com).

### 3. Generate `output.csv` (the graded artifact)

```bash
python -m backend.graph
```

This runs the full multi-agent pipeline against every row in
`dataset/requests.csv`, writes `output.csv` to the repo root, and writes
`evaluation/usage_report.md` summarizing the real token usage/cost of that run.

A pure-deterministic fallback (no LLM calls, no `.env` needed) is also available:

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
execute live, with tabs for the output table, the review queue (low-confidence
or injection-flagged extractions needing human sign-off), and the usage report.

---

## Our Approach

We built this as a **hybrid deterministic-core / multi-agent system**, orchestrated
with **LangGraph** and traced with **LangSmith**, on top of **Groq** (via
`langchain-groq`) for the LLM calls.

**Why hybrid, not end-to-end agentic:** the graded fields (`amount_safe_to_pay`,
`affordability_status`, the ranking tiebreak, the 90-day safety check) are exact,
reproducible numeric/date rules. An LLM is unreliable at that kind of arithmetic
and its output can't be guaranteed reproducible across runs. So the numeric core
stays in plain deterministic Python (`backend/main.py`), and LangGraph is used
only to orchestrate the three places where genuine unstructured-data reasoning
is required.

### Two LangGraph graphs (`backend/graph.py`)

1. **Ledger reconstruction graph** — runs once per user:
   `load context → image agent (conditional) → message agent (conditional) → apply deltas`
   - **Image agent**: reads a linked receipt/screenshot PNG to fill in a blank
     `amount` on a financial event (vision LLM call).
   - **Message agent**: parses a message linked to a financial event into a
     structured delta — `cancel | amend | delay | confirm | clarify | no_op`.
   - Both are skipped entirely (conditional edges) when a user has no blank
     amounts / no linked messages, so cost tracks actual ambiguity in the data.
   - Both agents treat their input as **untrusted data**: a regex guard
     (`backend/injection_guard.py`) plus explicit prompt instructions stop
     embedded "ignore previous instructions"-style text from being followed,
     and anything low-confidence or flagged goes to a **review queue**
     surfaced in the dashboard instead of being silently applied.

2. **Decision graph** — runs once per request:
   `compute (deterministic forecast → candidates → rank) → explain (LLM) → validate`
   - `compute` reuses `backend/main.py`'s proven 90-day forecast, candidate
     generation, and the spec's 6-level ranking tiebreak.
   - `explain` asks an LLM to rewrite the deterministic explanation in clearer
     prose, but a grounding check rejects the rewrite (falling back to the
     deterministic text) if it drops any required number/currency — so the
     explanation can never invent a fact.
   - `validate` re-checks the row against the spec's bounds/schema rules; on
     failure it falls back to the plain deterministic decision (no LLM
     influence at all), which is guaranteed to validate.

### Efficiency

- Every LLM call (image, message, explanation) is cached in
  `backend/extraction_cache.sqlite`, keyed by item id (+ a content hash for
  explanations), so re-running the pipeline after a code change doesn't
  re-spend tokens on unaffected requests.
- `evaluation/usage_report.md` is generated from real, tracked token counts of
  the run that produced `output.csv` — not estimated after the fact.

### Known limitation

The available Groq API key/plan does not currently expose a vision-capable
model (`client.models.list()` returns text-only models). Blank-amount events
whose image can't be read are left blank rather than guessed (per the spec's
"never treat a blank amount as zero" rule) and surfaced in the review queue for
manual resolution. Swap `GROQ_VISION_MODEL` in `backend/llm_agents.py` once a
vision model is available on the account.

## Important File Locations

```text
dataset/                    Input data and the blank output template. Do not modify.
backend/
  main.py                   Deterministic engine: forecast, candidates, ranking, validation.
  graph.py                  LangGraph orchestration (ledger graph + decision graph).
  llm_agents.py             The 3 LLM agents (image extraction, message parsing, explanation).
  injection_guard.py        Regex guard against prompt injection in untrusted content.
  usage_tracker.py          Real per-model token/cost tracking -> evaluation/usage_report.md.
  extraction_cache.py       SQLite cache so repeated runs don't re-spend LLM tokens.
  api.py                    FastAPI wrapper around graph.py for the ops dashboard.
frontend/                   React/Vite operations dashboard (talks to backend/api.py).
code/                       Compatibility launcher for `python3 code/main.py`.
requirements.txt            Python dependencies (langgraph, langsmith, langchain-groq, ...).
output.csv                  Final generated predictions in the repository root.
evaluation/usage_report.md  Token usage & cost report for the run that produced output.csv.
code.zip                    ZIP file containing your complete solution for submission.
```

The blank template at `dataset/output.csv` is provided as a reference. Your final generated file must be the root-level `output.csv`.

---

## Dataset Layout

```text
dataset/
├── requests.csv                  # 250 requests to evaluate — predict these
├── output.csv                    # Blank submission template
├── sample_requests.csv           # 25 solved examples
├── financial_profiles.csv        # Balances, minimum balance, priorities, preferences
├── financial_events.csv          # Historical, pending, and confirmed transactions
├── request_payment_options.csv   # Payment options available per request
├── exchange_rates.csv            # Fixed, dated conversion rates
├── messages.csv                  # Messages tied to users, requests, or events
├── images.csv                    # Payroll letters, statements, bills, receipts
└── media/images/                 # PNGs referenced by images.csv
```

Only `dataset/requests.csv` requires predictions. Everything else is context. Join user records with `user_id`, request records with `request_id`, supporting evidence with `related_event_id`, and exchange rates with the rate date and currency pair.

Amounts are in the user's `home_currency` — the dataset uses INR, ZAR, IDR, USD, and EUR, and every conversion rate you need is in `exchange_rates.csv`. All dates are `YYYY-MM-DD`. Live exchange rates, market data, and banking access are not required.

---

## What You Need to Build

For every row in `dataset/requests.csv`, produce one row in `output.csv` with:

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

`0 <= amount_safe_to_pay <= requested_amount` must always hold. Installment plans must exactly match a supplied payment option, and only recurring expenses marked flexible may be changed.

`affordable_with_plan` means the full request is completed through a partial-payment schedule, installments, or permitted spending changes. Recommend `partial_payment` only when the request allows it, the user accepts it, `0 < amount_safe_to_pay < requested_amount`, and `earliest_date_for_full_payment` is on or before `desired_completion_date`. Use exactly two payments: pay `amount_safe_to_pay` on `request_date`, then pay the remaining amount on `earliest_date_for_full_payment`. The two payments must add up to `requested_amount`. Unlike installments, partial payment does not need to match a supplied payment option.

---

## Suggested Workflow

1. Inspect `dataset/sample_requests.csv` — 25 requests with completed output columns — to understand the expected format and decision style.
2. Reconstruct each user's financial state from `financial_profiles.csv` and `financial_events.csv`: separate recurring expenses from one-time events, reserve pending transactions, count confirmed salary only on its settlement date, and de-duplicate repeated representations of the same event.
3. When an event has a blank `amount`, find its `event_id` as `related_event_id` in `images.csv` and extract the amount from the linked image. Never treat a blank amount as zero. Pull in any other relevant messages, images, and payment options for the request.
4. Forecast forward and generate a plan that keeps the balance above the minimum at every step.
5. Verify deterministically — bounds, plan feasibility, schedule match, flexible-only spending changes — before writing `output.csv`.
6. Score yourself on the solved samples, then run the full dataset.

You may use any language or runtime. Python, JavaScript, and TypeScript are all reasonable choices.

---

## Requirements

Your solution must:

- be runnable from the terminal
- read the provided files from `dataset/`
- produce a valid `output.csv` with the exact required columns in the exact required order
- include one prediction for every `request_id` in `dataset/requests.csv`
- not use organizer-only files or hardcoded labels
- keep behavior deterministic where possible

If you use API keys or secrets, read them from environment variables. Never hardcode secrets in the repo.

---

## Evaluation

Your `output.csv` will be compared against hidden ground-truth values.

The scoring will consider:

- accuracy of `amount_safe_to_pay`
- correctness of `affordability_status`
- correctness of `recommended_payment_method` and `payment_plan`
- accuracy of `earliest_date_for_full_payment`
- validity of `spending_changes_needed`
- usefulness and consistency of `decision_explanation`

### Token Usage And Cost Analysis

Your `code.zip` must include one token-usage file:

```text
evaluation/usage_report.md
```

The report must cover model providers and names, model calls, input and output tokens, total and average tokens per request, estimated total and per-request cost. The reported values must correspond to the final full-dataset run that produced your `output.csv`.

---

## Chat Transcript Logging

This repo includes an [`AGENTS.md`](./AGENTS.md) file for AI coding tools. It asks compatible tools to append conversation summaries to a `log.txt` in the repository root — the same directory as `AGENTS.md`:

| Platform | Path |
|---|---|
| macOS / Linux | `<repo root>/log.txt` |
| Windows | `<repo root>\log.txt` |

The path resolves relative to `AGENTS.md`, so it stays correct across clones, renames, and checkouts. `log.txt` is gitignored — upload it as your chat transcript at submission time. Do not paste secrets into the chat.

In case, the harness you are using is not in the repo root, you can explicitly ask the agent to look for the AGENTS.md in this folder & then continue.

---

## Submission

Submit the following files as instructed by HackerRank:

| File | Description |
|---|---|
| `code.zip` | Full runnable solution, prompts/configuration, README, and the required `evaluation/` folder |
| `output.csv` | Predictions for every row in `dataset/requests.csv` |
| `chat_transcript` | The `log.txt` described above, showing how you developed or used the system |

Before submitting, confirm:

- `output.csv` has one row per row in `dataset/requests.csv` (250 rows plus the header).
- `output.csv` has the exact required columns in the exact required order.
- Every `amount_safe_to_pay` satisfies `0 <= amount_safe_to_pay <= requested_amount`.
- Every installment plan matches a supplied payment option, and every spending change targets a flexible recurring expense.
- Your runnable code, setup instructions, and `evaluation/` folder are included in `code.zip`.
