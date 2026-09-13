from __future__ import annotations

import csv
import hashlib
import os
from pathlib import Path
from typing import List, Optional, TypedDict

from dotenv import load_dotenv
from langgraph.graph import END, StateGraph

try:
    from . import llm_agents
    from . import main as core
    from .extraction_cache import ExtractionCache
    from .usage_tracker import UsageTracker
except ImportError:
    import llm_agents
    import main as core
    from extraction_cache import ExtractionCache
    from usage_tracker import UsageTracker

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIDENT = {"high", "medium"}


def _setup_langsmith() -> bool:
    load_dotenv(BASE_DIR / "backend" / ".env")
    api_key = os.getenv("LANGSMITH_API_KEY") or os.getenv("LANGCHAIN_API_KEY")
    if not api_key:
        return False
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ.setdefault("LANGCHAIN_API_KEY", api_key)
    os.environ.setdefault("LANGCHAIN_PROJECT", os.getenv("LANGCHAIN_PROJECT", "buy-or-wait"))
    return True


# --------------------------------------------------------------------------
# Ledger reconstruction graph: retrieval -> image agent -> message agent ->
# apply deltas. Runs once per user (not once per request).
# --------------------------------------------------------------------------

class LedgerState(TypedDict, total=False):
    dataset: core.Dataset
    user_id: str
    cache: ExtractionCache
    usage: UsageTracker
    raw_events: List[dict]
    images: List[dict]
    messages: List[dict]
    image_deltas: dict
    message_deltas: dict
    resolved_events: List[dict]


def n_load_user_ledger(state: LedgerState) -> dict:
    dataset = state["dataset"]
    user_id = state["user_id"]
    raw_events = [dict(e) for e in dataset.events_by_user[user_id]]
    event_ids = {e["event_id"] for e in raw_events}
    images = [img for img in dataset.images if img.get("related_event_id") in event_ids]
    messages = [m for m in dataset.messages if m.get("related_event_id") in event_ids]
    return {"raw_events": raw_events, "images": images, "messages": messages}


def _route_after_load(state: LedgerState) -> str:
    has_blank = any(not (e.get("amount") or "").strip() for e in state["raw_events"])
    return "image_agent" if (has_blank and state["images"]) else _route_after_image(state)


def _route_after_image(state: LedgerState) -> str:
    return "message_agent" if state["messages"] else "apply_deltas"


def n_image_agent(state: LedgerState) -> dict:
    cache: ExtractionCache = state["cache"]
    tracker: UsageTracker = state["usage"]
    images_by_event = {img["related_event_id"]: img for img in state["images"]}
    deltas = {}
    for event in state["raw_events"]:
        if (event.get("amount") or "").strip():
            continue
        image = images_by_event.get(event["event_id"])
        if not image:
            continue
        cache_key = f"img::{image['image_id']}"
        cached = cache.get(cache_key, llm_agents.VISION_MODEL)
        if cached is not None:
            deltas[event["event_id"]] = cached
            continue
        image_path = BASE_DIR / "dataset" / "media" / "images" / f"{image['image_id']}.png"
        result = llm_agents.extract_image_amount(image["image_id"], image_path, tracker)
        cache.set(cache_key, llm_agents.VISION_MODEL, result)
        deltas[event["event_id"]] = result
    return {"image_deltas": deltas}


def n_message_agent(state: LedgerState) -> dict:
    cache: ExtractionCache = state["cache"]
    tracker: UsageTracker = state["usage"]
    events_by_id = {e["event_id"]: e for e in state["raw_events"]}
    deltas = {}
    for message in state["messages"]:
        target_id = message.get("related_event_id")
        event = events_by_id.get(target_id)
        if not event:
            continue
        cache_key = f"msg::{message['message_id']}"
        cached = cache.get(cache_key, llm_agents.TEXT_MODEL)
        if cached is not None:
            result = cached
        else:
            context = {
                "event_id": event.get("event_id"),
                "category": event.get("category"),
                "amount": event.get("amount"),
                "status": event.get("status"),
                "event_date": event.get("event_date"),
                "settlement_date": event.get("settlement_date"),
            }
            result = llm_agents.parse_message(message["message_id"], message.get("message_text", ""), context, tracker)
            cache.set(cache_key, llm_agents.TEXT_MODEL, result)
        # Newer message wins if multiple target the same event (conflict rule #2).
        existing = deltas.get(target_id)
        if existing is None or (message.get("sent_at", "") >= existing.get("_sent_at", "")):
            result = dict(result)
            result["_sent_at"] = message.get("sent_at", "")
            deltas[target_id] = result
    return {"message_deltas": deltas}


def n_apply_deltas(state: LedgerState) -> dict:
    events = state["raw_events"]
    message_deltas = state.get("message_deltas", {})
    image_deltas = state.get("image_deltas", {})

    for event in events:
        delta = message_deltas.get(event["event_id"])
        if delta and not delta.get("injection_flagged") and delta.get("confidence") in CONFIDENT:
            action = delta.get("action")
            if action == "cancel":
                event["status"] = "cancelled"
            elif action == "amend":
                if delta.get("new_amount") is not None:
                    event["amount"] = str(delta["new_amount"])
                if delta.get("new_date"):
                    event["settlement_date"] = delta["new_date"]
            elif action == "delay" and delta.get("new_date"):
                event["settlement_date"] = delta["new_date"]
            # confirm / clarify / no_op: no ledger mutation needed.

    for event in events:
        if (event.get("amount") or "").strip():
            continue
        delta = image_deltas.get(event["event_id"])
        if delta and not delta.get("injection_flagged") and delta.get("confidence") in CONFIDENT and delta.get("amount") is not None:
            event["amount"] = str(delta["amount"])

    return {"resolved_events": events}


def build_ledger_graph():
    graph = StateGraph(LedgerState)
    graph.add_node("load", n_load_user_ledger)
    graph.add_node("image_agent", n_image_agent)
    graph.add_node("message_agent", n_message_agent)
    graph.add_node("apply_deltas", n_apply_deltas)

    graph.set_entry_point("load")
    graph.add_conditional_edges("load", _route_after_load, {
        "image_agent": "image_agent",
        "message_agent": "message_agent",
        "apply_deltas": "apply_deltas",
    })
    graph.add_conditional_edges("image_agent", _route_after_image, {
        "message_agent": "message_agent",
        "apply_deltas": "apply_deltas",
    })
    graph.add_edge("message_agent", "apply_deltas")
    graph.add_edge("apply_deltas", END)
    return graph.compile()


# --------------------------------------------------------------------------
# Decision graph: deterministic compute -> explanation agent -> validate
# (with a deterministic safety-net fallback). Runs once per request.
# --------------------------------------------------------------------------

class DecisionState(TypedDict, total=False):
    dataset: core.Dataset
    request: dict
    profile: dict
    resolved_events: Optional[List[dict]]
    usage: UsageTracker
    cache: Optional[ExtractionCache]
    row: dict
    facts: dict


def n_compute(state: DecisionState) -> dict:
    dataset = state["dataset"]
    request = state["request"]
    profile = state["profile"]
    currency = profile["home_currency"]
    req_date = core.parse_date(request["request_date"])
    events = core.build_cash_events(dataset, request["user_id"], currency, req_date, raw_events=state.get("resolved_events"))
    row, facts = core.build_row(dataset, request, profile, events)
    return {"row": row, "facts": facts}


def n_explain(state: DecisionState) -> dict:
    row = state["row"]
    cache = state.get("cache")
    # Hash the deterministic draft into the key so a changed forecast/ranking
    # (different draft text) invalidates the cached rewrite automatically.
    draft_hash = hashlib.sha1(row["decision_explanation"].encode("utf-8")).hexdigest()[:12]
    cache_key = f"explain::{state['request']['request_id']}::{draft_hash}"

    text = cache.get(cache_key, llm_agents.TEXT_MODEL) if cache else None
    if text is None:
        text = llm_agents.write_explanation(state["facts"], row["decision_explanation"], state["usage"])
        if cache:
            cache.set(cache_key, llm_agents.TEXT_MODEL, text)

    row = dict(row)
    row["decision_explanation"] = text
    return {"row": row}


def n_validate(state: DecisionState) -> dict:
    row = state["row"]
    request = state["request"]
    dataset = state["dataset"]
    try:
        core.validate_row(row, request, dataset)
        return {"row": row}
    except ValueError:
        # Deterministic safety net: fall back to the plain rules-only decision
        # (no LLM-derived ledger changes), which is guaranteed to validate.
        fallback_row = core.decide(dataset, request)
        return {"row": fallback_row}


def build_decision_graph():
    graph = StateGraph(DecisionState)
    graph.add_node("compute", n_compute)
    graph.add_node("explain", n_explain)
    graph.add_node("validate", n_validate)
    graph.set_entry_point("compute")
    graph.add_edge("compute", "explain")
    graph.add_edge("explain", "validate")
    graph.add_edge("validate", END)
    return graph.compile()


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def run_pipeline() -> None:
    traced = _setup_langsmith()
    print(f"LangSmith tracing: {'enabled' if traced else 'disabled (no LANGSMITH_API_KEY)'}")

    dataset = core.Dataset()
    cache = ExtractionCache()
    usage = UsageTracker()

    ledger_graph = build_ledger_graph()
    decision_graph = build_decision_graph()

    resolved_by_user: dict[str, List[dict]] = {}
    rows: List[dict] = []

    for request in dataset.requests:
        user_id = request["user_id"]
        if user_id not in resolved_by_user:
            result = ledger_graph.invoke({"dataset": dataset, "user_id": user_id, "cache": cache, "usage": usage})
            resolved_by_user[user_id] = result["resolved_events"]

        profile = dataset.profiles[user_id]
        state = decision_graph.invoke({
            "dataset": dataset,
            "request": request,
            "profile": profile,
            "resolved_events": resolved_by_user[user_id],
            "usage": usage,
            "cache": cache,
        })
        rows.append(state["row"])

    with open(BASE_DIR / "output.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=core.OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    for eval_dir in (BASE_DIR / "backend" / "evaluation", BASE_DIR / "evaluation"):
        usage.write_report(eval_dir / "usage_report.md", len(rows))

    print(f"Wrote {len(rows)} predictions to {BASE_DIR / 'output.csv'}")
    print(f"LLM calls made: {sum(usage.calls.values())} across {len(usage.calls)} model(s)")


if __name__ == "__main__":
    run_pipeline()
