from __future__ import annotations

import asyncio
import threading
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from . import graph as g
    from . import main as core
    from .extraction_cache import ExtractionCache
    from .usage_tracker import UsageTracker
except ImportError:
    import graph as g
    import main as core
    from extraction_cache import ExtractionCache
    from usage_tracker import UsageTracker

BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="Buy-or-Wait Ops API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

images_dir = BASE_DIR / "dataset" / "media" / "images"
if images_dir.exists():
    app.mount("/media/images", StaticFiles(directory=images_dir), name="images")

# Global in-memory state (single-process ops dashboard, not for production use).
DATASET: core.Dataset | None = None
RUNS: dict[str, dict] = {}
OUTPUT: dict[str, list] = {}
REVIEW_QUEUE: dict[str, list] = {}
USAGE: dict[str, UsageTracker] = {}


@app.on_event("startup")
async def startup_event():
    global DATASET
    DATASET = core.Dataset()
    traced = g._setup_langsmith()
    print(f"LangSmith tracing: {'enabled' if traced else 'disabled (no LANGSMITH_API_KEY)'}")


def _review_entries(run_id: str, request_id: str, source_type: str, item_id: str, delta: dict, source_content: str) -> None:
    if delta.get("injection_flagged") or delta.get("confidence") == "low":
        REVIEW_QUEUE[run_id].append({
            "id": f"rq-{source_type}-{item_id}",
            "request_id": request_id,
            "flag_reason": "injection_pattern" if delta.get("injection_flagged") else "low_confidence",
            "extracted_value": str(delta),
            "source_type": source_type,
            "source_content": source_content,
            "image_url": f"/media/images/{item_id}.png" if source_type == "image" else None,
        })


def run_pipeline(run_id: str) -> None:
    RUNS[run_id]["status"] = "running"
    dataset = DATASET
    cache = ExtractionCache()
    usage = UsageTracker()
    USAGE[run_id] = usage

    ledger_graph = g.build_ledger_graph()
    decision_graph = g.build_decision_graph()
    resolved_by_user: dict[str, list] = {}
    user_requests: dict[str, str] = {req["user_id"]: req["request_id"] for req in dataset.requests}

    try:
        for request in dataset.requests:
            user_id = request["user_id"]
            if user_id not in resolved_by_user:
                ledger_state = ledger_graph.invoke({"dataset": dataset, "user_id": user_id, "cache": cache, "usage": usage})
                resolved_by_user[user_id] = ledger_state["resolved_events"]
                for image_id, delta in ledger_state.get("image_deltas", {}).items():
                    _review_entries(run_id, user_requests.get(user_id, ""), "image", image_id, delta, image_id)
                for event_id, delta in ledger_state.get("message_deltas", {}).items():
                    _review_entries(run_id, user_requests.get(user_id, ""), "message", event_id, delta, delta.get("rationale", ""))

            profile = dataset.profiles[user_id]
            decision_state = decision_graph.invoke({
                "dataset": dataset,
                "request": request,
                "profile": profile,
                "resolved_events": resolved_by_user[user_id],
                "usage": usage,
                "cache": cache,
            })
            OUTPUT[run_id].append(decision_state["row"])
            RUNS[run_id]["rows_processed"] += 1

        for eval_dir in (BASE_DIR / "backend" / "evaluation", BASE_DIR / "evaluation"):
            usage.write_report(eval_dir / "usage_report.md", len(OUTPUT[run_id]))

        RUNS[run_id]["status"] = "done"
    except Exception as exc:
        traceback.print_exc()
        print(f"Run {run_id} failed: {exc}")
        RUNS[run_id]["status"] = "failed"


@app.post("/runs")
async def start_run():
    run_id = f"run-{uuid.uuid4().hex[:8]}"
    RUNS[run_id] = {
        "id": run_id,
        "run_id": run_id,
        "started_at": "now",
        "status": "queued",
        "rows_processed": 0,
        "total_rows": len(DATASET.requests) if DATASET else 0,
    }
    REVIEW_QUEUE[run_id] = []
    OUTPUT[run_id] = []

    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, run_pipeline, run_id)
    return {"id": run_id, "run_id": run_id}


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


class ResolvePayload(BaseModel):
    action: str


@app.post("/runs/{run_id}/review-queue/{row_id}/resolve")
async def resolve_review_item(run_id: str, row_id: str, payload: ResolvePayload):
    if run_id not in REVIEW_QUEUE:
        raise HTTPException(status_code=404)
    queue = REVIEW_QUEUE[run_id]
    queue[:] = [item for item in queue if item["id"] != row_id]
    return {"status": "ok", "action": payload.action}


@app.get("/runs/{run_id}/usage-report")
async def get_usage_report(run_id: str):
    if run_id not in RUNS:
        raise HTTPException(status_code=404)

    usage = USAGE.get(run_id)
    models = usage.as_models_list() if usage else []
    total_calls = sum(m["calls"] for m in models)
    total_tokens = sum(m["total_tokens"] for m in models)
    total_cost = usage.total_cost() if usage else 0.0
    requests_processed = RUNS[run_id].get("rows_processed", 0)

    report_path = BASE_DIR / "backend" / "evaluation" / "usage_report.md"
    fallback_report_path = BASE_DIR / "evaluation" / "usage_report.md"
    raw_markdown = ""
    if report_path.exists():
        raw_markdown = report_path.read_text(encoding="utf-8")
    elif fallback_report_path.exists():
        raw_markdown = fallback_report_path.read_text(encoding="utf-8")

    return {
        "models": models,
        "summary": {
            "total_calls": total_calls,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
            "requests_processed": requests_processed,
            "avg_tokens_per_request": (total_tokens / requests_processed) if requests_processed else 0,
            "avg_cost_per_request": (total_cost / requests_processed) if requests_processed else 0,
        },
        "raw_markdown": raw_markdown,
    }
