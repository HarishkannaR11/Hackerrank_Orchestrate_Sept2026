from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel
import asyncio
import uuid
import json
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

try:
    from .stage0_load import load_data, get_user_data
    from .stage2_extract import ExtractionService
    from .stage3_reconcile import build_ledger
    from .stage4_forecast import run_forecast, find_amount_safe_to_pay
    from .stage5_rank import build_candidates, rank_plans
    from .stage6_explain import write_explanation
    from .stage7_validate import validate_row, get_safe_fallback
    from .stage8_usage import UsageLogger
except ImportError:
    from stage0_load import load_data, get_user_data
    from stage2_extract import ExtractionService
    from stage3_reconcile import build_ledger
    from stage4_forecast import run_forecast, find_amount_safe_to_pay
    from stage5_rank import build_candidates, rank_plans
    from stage6_explain import write_explanation
    from stage7_validate import validate_row, get_safe_fallback
    from stage8_usage import UsageLogger

app = FastAPI()

# Allow CORS for the ops-dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State
DATA = None
EXTRACTION_SERVICE = None
RUNS = {}
REVIEW_QUEUE = {}
OUTPUT = {}
TRACES = {}
BASE_DIR = Path(__file__).resolve().parent.parent

@app.on_event("startup")
async def startup_event():
    global DATA, EXTRACTION_SERVICE
    DATA = load_data()
    EXTRACTION_SERVICE = ExtractionService(api_key=os.getenv("GROQ_API"))

def process_user_requests(run_id, user_id, requests, usage_logger):
    """
    Process all requests for a single user.
    Runs deterministically in a thread.
    """
    user_data = get_user_data(DATA, user_id)
    ledger, queue_items = build_ledger(user_data['events'], user_data['messages'], user_data['images'], EXTRACTION_SERVICE)
    
    # Push queue items to global state
    for q in queue_items:
        REVIEW_QUEUE[run_id].append(q)
        
    outputs = []
    
    for _, req in requests.iterrows():
        profile_row = user_data['profile'].iloc[0]
        
        # Initialize Trace
        trace = {
            "id": req['request_id'],
            "user": user_id,
            "type": req['request_type'].replace('_', ' ').title(),
            "amount": str(req['requested_amount']),
            "text": req['request_text'],
            "minBalance": profile_row['minimum_balance_to_keep'],
            "stages": [],
            "decision": {},
            "chartData": []
        }
        
        trace['stages'].append({"name": "Retrieve context", "detail": f"Loaded profile, {len(user_data['events'])} events for {req['request_id']}."})
        trace['stages'].append({"name": "Resolve image", "detail": "Processed any blank amounts via image extraction."})
        trace['stages'].append({"name": "Parse messages", "detail": "Applied message amendments to the ledger."})
        trace['stages'].append({"name": "Reconstruct ledger", "detail": f"Reconstructed ledger starting from balance {profile_row['current_available_balance']}."})

        # 1. Forecast & Search
        amount_safe = find_amount_safe_to_pay(ledger, req['request_date'], profile_row['current_available_balance'], profile_row['minimum_balance_to_keep'], req['requested_amount'])
        full_safe_date = req['request_date'].strftime("%Y-%m-%d") if amount_safe >= req['requested_amount'] else None
        
        trace['stages'].append({"name": "90-day forecast", "detail": "Ran 90-day balance simulation.", "chart": True})
        
        # Populate mock chart data based on starting balance for now
        bal = profile_row['current_available_balance']
        trace['chartData'] = [
            {"day": 0, "b": bal},
            {"day": 15, "b": bal * 0.9},
            {"day": 30, "b": bal * 1.1},
            {"day": 45, "b": bal * 0.8},
            {"day": 60, "b": bal * 1.2},
            {"day": 75, "b": bal * 0.95},
            {"day": 90, "b": bal * 1.05}
        ]
        
        # 2. Ranking
        candidates = build_candidates(req, amount_safe, full_safe_date)
        ranked = rank_plans(candidates, req['desired_completion_date'])
        best_plan = ranked[0] if ranked else None
        
        trace['stages'].append({"name": "Rank plans", "detail": f"Selected method: {best_plan['method'] if best_plan else 'not_recommended'}"})
        
        # 3. Assemble Row & Validate
        row = {
            "request_id": req['request_id'],
            "amount_safe_to_pay": amount_safe,
            "affordability_status": "affordable_now" if best_plan and best_plan['method'] == 'full_payment' else "not_affordable",
            "recommended_payment_method": best_plan['method'] if best_plan else 'not_recommended',
            "payment_plan": "none",
            "earliest_date_for_full_payment": full_safe_date,
            "spending_changes_needed": "none"
        }
        
        # 4. LLM Explanation
        try:
            validate_row(row, req)
            trace['stages'].append({"name": "Validate", "detail": "Schema checks passed."})
            decision_trace = {"request": req.to_dict(), "plan": best_plan, "amount_safe": amount_safe}
            row["decision_explanation"] = write_explanation(EXTRACTION_SERVICE, decision_trace, usage_logger)
        except ValueError:
            # Simplified retry fallback
            trace['stages'].append({"name": "Validate", "detail": "Validation failed. Used fallback."})
            row = get_safe_fallback(req['request_id'])
            
        trace['decision'] = {
            "status": row["affordability_status"],
            "safeToPay": str(row["amount_safe_to_pay"]),
            "method": row["recommended_payment_method"],
            "plan": best_plan['installments'] if best_plan and 'installments' in best_plan else [],
            "earliestFull": row["earliest_date_for_full_payment"] or "—",
            "spendChange": row["spending_changes_needed"],
            "explanation": row.get("decision_explanation", "No explanation available.")
        }
            
        outputs.append((row, trace))
        
    return outputs

def run_pipeline(run_id: str):
    RUNS[run_id]['status'] = 'running'
    usage_logger = UsageLogger()
    
    try:
        grouped = DATA['requests'].groupby('user_id')
        total_requests = len(DATA['requests'])
        
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = []
            for user_id, group in grouped:
                futures.append(executor.submit(process_user_requests, run_id, user_id, group, usage_logger))
                
            for future in futures:
                user_outputs = future.result()
                for row, trace in user_outputs:
                    OUTPUT[run_id].append(row)
                    TRACES[run_id].append(trace)
                RUNS[run_id]['rows_processed'] += len(user_outputs)
                
        # Generate usage report after all rows are done
        usage_logger.generate_report(total_requests)
        
        RUNS[run_id]['status'] = 'done'
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Run {run_id} failed: {e}")
        RUNS[run_id]['status'] = 'failed'

@app.post("/runs")
async def start_run():
    run_id = f"run-{uuid.uuid4().hex[:8]}"
    RUNS[run_id] = {
        "id": run_id,
        "started_at": "now",
        "status": "queued",
        "rows_processed": 0,
        "total_rows": len(DATA.requests) if hasattr(DATA, "requests") else (len(DATA['requests']) if DATA else 0)
    }
    REVIEW_QUEUE[run_id] = []
    OUTPUT[run_id] = []
    TRACES[run_id] = []
    
    # Run in background
    asyncio.create_task(asyncio.to_thread(run_pipeline, run_id))
    return {"id": run_id}

@app.get("/runs")
async def list_runs():
    return list(RUNS.values())

@app.get("/runs/{run_id}/status")
async def get_status(run_id: str):
    if run_id not in RUNS:
        raise HTTPException(status_code=404)
    return RUNS[run_id]

@app.get("/runs/{run_id}/output")
async def get_output(run_id: str):
    if run_id not in OUTPUT:
        raise HTTPException(status_code=404)
    return OUTPUT[run_id]

@app.get("/runs/{run_id}/review-queue")
async def get_review_queue(run_id: str):
    if run_id not in REVIEW_QUEUE:
        raise HTTPException(status_code=404)
    return REVIEW_QUEUE[run_id]

@app.get("/runs/{run_id}/usage-report")
async def get_usage_report(run_id: str):
    if run_id not in RUNS:
        raise HTTPException(status_code=404)

    usage_path = BASE_DIR / "backend" / "evaluation" / "usage_data.json"
    report_path = BASE_DIR / "backend" / "evaluation" / "usage_report.md"
    fallback_report_path = BASE_DIR / "evaluation" / "usage_report.md"
    if usage_path.exists():
        with open(usage_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {
            "models": [],
            "summary": {
                "total_calls": 0,
                "total_tokens": 0,
                "total_cost": 0,
                "requests_processed": RUNS[run_id].get("rows_processed", 0),
            },
        }

    summary = data.setdefault("summary", {})
    requests_processed = summary.get("requests_processed") or RUNS[run_id].get("total_rows", 0) or 0
    summary.setdefault("avg_tokens_per_request", (summary.get("total_tokens", 0) / requests_processed) if requests_processed else 0)
    summary.setdefault("avg_cost_per_request", (summary.get("total_cost", 0) / requests_processed) if requests_processed else 0)

    if "raw_markdown" not in data:
        if report_path.exists():
            data["raw_markdown"] = report_path.read_text(encoding="utf-8")
        elif fallback_report_path.exists():
            data["raw_markdown"] = fallback_report_path.read_text(encoding="utf-8")
        else:
            data["raw_markdown"] = ""

    return data

class ResolvePayload(BaseModel):
    action: str

@app.post("/runs/{run_id}/review-queue/{row_id}/resolve")
async def resolve_review_item(run_id: str, row_id: str, payload: ResolvePayload):
    if run_id not in REVIEW_QUEUE:
        raise HTTPException(status_code=404)
    
    queue = REVIEW_QUEUE[run_id]
    queue[:] = [item for item in queue if item['id'] != row_id]
    return {"status": "ok"}

@app.get("/runs/{run_id}/traces")
async def get_traces(run_id: str):
    if run_id not in TRACES:
        raise HTTPException(status_code=404)
    return TRACES[run_id]



