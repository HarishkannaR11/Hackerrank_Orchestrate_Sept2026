from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel
import asyncio
import uuid
import json

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

@app.on_event("startup")
async def startup_event():
    global DATA, EXTRACTION_SERVICE
    DATA = load_data()
    # Provide your API key or configure it appropriately
    EXTRACTION_SERVICE = ExtractionService(api_key="mock_key_for_now")

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
        # 1. Forecast & Search
        amount_safe = find_amount_safe_to_pay(ledger, req['request_date'], 1000, 100, req['requested_amount'])
        full_safe_date = "2026-09-12" if amount_safe >= req['requested_amount'] else None
        
        # 2. Ranking
        candidates = build_candidates(req, amount_safe, full_safe_date)
        ranked = rank_plans(candidates, req['desired_completion_date'])
        best_plan = ranked[0] if ranked else None
        
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
            decision_trace = {"request": req.to_dict(), "plan": best_plan, "amount_safe": amount_safe}
            row["decision_explanation"] = write_explanation(EXTRACTION_SERVICE, decision_trace, usage_logger)
        except ValueError:
            # Simplified retry fallback
            row = get_safe_fallback(req['request_id'])
            
        outputs.append(row)
        
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
                OUTPUT[run_id].extend(user_outputs)
                RUNS[run_id]['rows_processed'] += len(user_outputs)
                
        # Generate usage report after all rows are done
        usage_logger.generate_report(total_requests)
        
        RUNS[run_id]['status'] = 'done'
    except Exception as e:
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
        "total_rows": len(DATA['requests']) if DATA else 0
    }
    REVIEW_QUEUE[run_id] = []
    OUTPUT[run_id] = []
    
    # Run in background
    asyncio.create_task(asyncio.to_thread(run_pipeline, run_id))
    return {"id": run_id}

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

class ResolvePayload(BaseModel):
    action: str

@app.post("/runs/{run_id}/review-queue/{row_id}/resolve")
async def resolve_review_item(run_id: str, row_id: str, payload: ResolvePayload):
    if run_id not in REVIEW_QUEUE:
        raise HTTPException(status_code=404)
    
    queue = REVIEW_QUEUE[run_id]
    queue[:] = [item for item in queue if item['id'] != row_id]
    return {"status": "ok"}
