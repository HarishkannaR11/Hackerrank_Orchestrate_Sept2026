from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, List, Optional, Tuple


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "dataset"
OUTPUT_COLUMNS = [
    "request_id",
    "amount_safe_to_pay",
    "affordability_status",
    "recommended_payment_method",
    "payment_plan",
    "earliest_date_for_full_payment",
    "spending_changes_needed",
    "decision_explanation",
]


def read_csv(name: str) -> List[dict]:
    with open(DATA_DIR / name, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def parse_date(value: str | None) -> Optional[date]:
    if not value:
        return None
    return datetime.strptime(value[:10], "%Y-%m-%d").date()


def parse_float(value, default: Optional[float] = 0.0) -> Optional[float]:
    if value is None:
        return default
    text = str(value).strip()
    if text == "" or text.lower() == "nan":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def fmt_amount(value: float) -> str:
    value = round(float(value) + 1e-9, 2)
    if abs(value - round(value)) < 0.005:
        return str(int(round(value)))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def split_pipe(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split("|") if part.strip()}


@dataclass
class CashEvent:
    event_id: str
    user_id: str
    category: str
    direction: str
    amount: float
    currency: str
    event_date: date
    settlement_date: date
    status: str
    event_type: str
    flexibility: str
    minimum_allowed_amount: Optional[float]
    description: str
    generated: bool = False

    @property
    def signed_amount(self) -> float:
        return self.amount if self.direction == "credit" else -self.amount


class Dataset:
    def __init__(self):
        self.requests = read_csv("requests.csv")
        self.profiles = {r["user_id"]: r for r in read_csv("financial_profiles.csv")}
        self.events = read_csv("financial_events.csv")
        self.payment_options = read_csv("request_payment_options.csv")
        self.exchange_rates = read_csv("exchange_rates.csv")
        self.messages = read_csv("messages.csv")
        self.images = read_csv("images.csv")

        self.options_by_request = defaultdict(list)
        for option in self.payment_options:
            self.options_by_request[option["request_id"]].append(option)

        self.events_by_user = defaultdict(list)
        for event in self.events:
            self.events_by_user[event["user_id"]].append(event)

        self.rates_by_pair = defaultdict(list)
        for row in self.exchange_rates:
            self.rates_by_pair[(row["from_currency"], row["to_currency"])].append(
                (parse_date(row["rate_date"]), parse_float(row["rate"], 1.0))
            )
        for rows in self.rates_by_pair.values():
            rows.sort(key=lambda x: x[0])

    def rate(self, when: date, from_currency: str, to_currency: str) -> float:
        if from_currency == to_currency:
            return 1.0
        pair = self.rates_by_pair.get((from_currency, to_currency))
        if not pair:
            inverse = self.rates_by_pair.get((to_currency, from_currency))
            if inverse:
                return 1.0 / self._rate_from_rows(inverse, when)
            return 1.0
        return self._rate_from_rows(pair, when)

    @staticmethod
    def _rate_from_rows(rows: List[Tuple[date, float]], when: date) -> float:
        chosen = rows[0][1]
        for rate_date, rate in rows:
            if rate_date and rate_date <= when:
                chosen = rate
            elif rate_date and rate_date > when:
                break
        return chosen


def resolve_event_chains(raw_events: Iterable[dict]) -> List[dict]:
    chains = defaultdict(list)
    for event in raw_events:
        base_id = event.get("linked_event_id") or event["event_id"]
        chains[base_id].append(event)

    resolved = []
    for chain in chains.values():
        chain.sort(key=lambda e: (parse_date(e.get("settlement_date")) or parse_date(e.get("event_date")) or date.min, e["event_id"]))
        explicit = [e for e in chain if e.get("status") in {"cancelled", "failed", "settled"}]
        resolved.append(explicit[-1] if explicit else chain[-1])
    return resolved


def build_cash_events(
    dataset: Dataset,
    user_id: str,
    home_currency: str,
    start: date,
    raw_events: Optional[List[dict]] = None,
) -> List[CashEvent]:
    events = []
    source = raw_events if raw_events is not None else dataset.events_by_user[user_id]
    for raw in resolve_event_chains(source):
        status = raw.get("status", "")
        event_type = raw.get("event_type", "")
        direction = raw.get("direction", "")
        amount = parse_float(raw.get("amount"), None)
        settlement = parse_date(raw.get("settlement_date")) or parse_date(raw.get("event_date"))
        event_day = parse_date(raw.get("event_date")) or settlement

        if status in {"cancelled", "failed", "unrealized"} or event_type == "investment_valuation":
            continue
        if amount is None or not settlement:
            continue
        if status == "pending" and direction == "credit":
            continue

        rate = dataset.rate(settlement, raw.get("currency", home_currency), home_currency)
        events.append(
            CashEvent(
                event_id=raw["event_id"],
                user_id=user_id,
                category=raw.get("category", ""),
                direction=direction,
                amount=amount * rate,
                currency=home_currency,
                event_date=event_day,
                settlement_date=settlement,
                status=status,
                event_type=event_type,
                flexibility=raw.get("flexibility", "fixed"),
                minimum_allowed_amount=parse_float(raw.get("minimum_allowed_amount"), None),
                description=raw.get("description", ""),
            )
        )

    events.extend(project_recurring_events(events, start, start + timedelta(days=90)))
    return events


def add_month(d: date) -> date:
    year = d.year + (d.month // 12)
    month = 1 if d.month == 12 else d.month + 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def project_recurring_events(events: List[CashEvent], start: date, end: date) -> List[CashEvent]:
    groups = defaultdict(list)
    for event in events:
        if event.settlement_date >= start or event.status not in {"settled", "scheduled"}:
            continue
        key = (
            event.user_id,
            event.event_type,
            event.description.lower(),
            event.category,
            event.direction,
            round(event.amount, 2),
        )
        groups[key].append(event)

    projected = []
    existing = {(e.description.lower(), e.category, e.direction, round(e.amount, 2), e.settlement_date) for e in events}
    for chain in groups.values():
        chain.sort(key=lambda e: e.settlement_date)
        if len(chain) < 3:
            continue
        gaps = [(b.settlement_date - a.settlement_date).days for a, b in zip(chain, chain[1:])]
        if not gaps or sum(1 for gap in gaps[-4:] if 25 <= gap <= 35) < min(2, len(gaps[-4:])):
            continue

        template = chain[-1]
        next_day = add_month(template.settlement_date)
        while next_day <= end:
            identity = (template.description.lower(), template.category, template.direction, round(template.amount, 2), next_day)
            if next_day >= start and identity not in existing:
                projected.append(
                    CashEvent(
                        event_id=template.event_id,
                        user_id=template.user_id,
                        category=template.category,
                        direction=template.direction,
                        amount=template.amount,
                        currency=template.currency,
                        event_date=next_day,
                        settlement_date=next_day,
                        status="projected",
                        event_type=template.event_type,
                        flexibility=template.flexibility,
                        minimum_allowed_amount=template.minimum_allowed_amount,
                        description=template.description,
                        generated=True,
                    )
                )
            next_day = add_month(next_day)
    return projected


def changed_amount(event: CashEvent, spending_changes: Tuple[str, ...]) -> float:
    amount = event.amount
    for change in spending_changes:
        parts = change.split(":")
        if len(parts) >= 2 and parts[1] == event.event_id:
            if parts[0] == "stop":
                return 0.0
            if parts[0] == "reduce_to" and len(parts) == 3:
                return min(amount, parse_float(parts[2], amount))
    return amount


def forecast_min_balance(
    events: List[CashEvent],
    start: date,
    starting_balance: float,
    min_balance: float,
    payments: List[Tuple[date, float]] | None = None,
    spending_changes: Tuple[str, ...] = (),
) -> Tuple[bool, float, Optional[date]]:
    end = start + timedelta(days=90)
    by_day = defaultdict(float)
    for event in events:
        if start <= event.settlement_date <= end:
            amount = changed_amount(event, spending_changes)
            by_day[event.settlement_date] += amount if event.direction == "credit" else -amount
    for payment_date, amount in payments or []:
        if start <= payment_date <= end:
            by_day[payment_date] -= amount

    balance = starting_balance
    lowest = balance
    fail_date = None
    for offset in range(91):
        current = start + timedelta(days=offset)
        balance += by_day[current]
        lowest = min(lowest, balance)
        if fail_date is None and balance < min_balance - 0.005:
            fail_date = current
    return fail_date is None, lowest, fail_date


def safe_amount_today(events: List[CashEvent], start: date, balance: float, min_balance: float, requested: float) -> float:
    _, lowest, _ = forecast_min_balance(events, start, balance, min_balance)
    return round(max(0.0, min(requested, lowest - min_balance)), 2)


def first_safe_full_date(events: List[CashEvent], start: date, balance: float, min_balance: float, requested: float) -> Optional[date]:
    for offset in range(91):
        candidate = start + timedelta(days=offset)
        ok, _, _ = forecast_min_balance(events, start, balance, min_balance, [(candidate, requested)])
        if ok:
            return candidate
    return None


def option_schedule(option: dict) -> List[Tuple[date, float]]:
    count = int(parse_float(option.get("number_of_payments"), 0) or 0)
    first = parse_date(option.get("first_payment_date"))
    amount = parse_float(option.get("payment_amount"), 0.0) or 0.0
    freq = int(parse_float(option.get("payment_frequency_days"), 0) or 0)
    if not first or count <= 0:
        return []
    return [(first + timedelta(days=freq * idx), amount) for idx in range(count)]


def plan_text(payments: List[Tuple[date, float]]) -> str:
    if not payments:
        return "none"
    return "|".join(f"{payment_date.isoformat()}:{fmt_amount(amount)}" for payment_date, amount in payments)


def candidate_spending_changes(events: List[CashEvent], profile: dict, start: date) -> List[Tuple[str, ...]]:
    reducible_categories = split_pipe(profile.get("expense_categories_user_is_willing_to_reduce"))
    stoppable_categories = split_pipe(profile.get("expense_categories_user_is_willing_to_stop"))
    protected = split_pipe(profile.get("expense_categories_to_protect"))
    future_debits = []
    for event in events:
        if event.direction != "debit" or event.settlement_date < start or event.category in protected:
            continue
        future_debits.append(event)

    changes = []
    seen = set()
    for event in sorted(future_debits, key=lambda e: (-e.amount, e.settlement_date, e.event_id)):
        if event.event_id in seen:
            continue
        if event.category in stoppable_categories and event.flexibility in {"stoppable", "reducible_or_stoppable"}:
            changes.append((f"stop:{event.event_id}",))
            seen.add(event.event_id)
        elif event.category in reducible_categories and event.flexibility in {"reducible", "reducible_or_stoppable"}:
            floor = event.minimum_allowed_amount if event.minimum_allowed_amount is not None else round(event.amount * 0.5, 2)
            if floor < event.amount:
                changes.append((f"reduce_to:{event.event_id}:{fmt_amount(floor)}",))
                seen.add(event.event_id)
        if len(changes) >= 12:
            break
    return [()] + changes


def explain(currency: str, status: str, method: str, amount: float, requested: float, min_seen: float, min_keep: float, full_date: Optional[date], changes: str) -> str:
    if status == "affordable_now":
        return f"Pay {currency} {fmt_amount(requested)} today. The 90-day forecast stays at or above {currency} {fmt_amount(min_seen)}, above the {currency} {fmt_amount(min_keep)} minimum."
    if method == "installments":
        return f"Use the selected installment schedule. It completes the request while keeping the projected balance at or above {currency} {fmt_amount(min_seen)}."
    if method == "partial_payment":
        return f"Pay {currency} {fmt_amount(amount)} now and the rest on {full_date.isoformat() if full_date else 'the safe date'}. This keeps the {currency} {fmt_amount(min_keep)} minimum protected."
    if method == "wait":
        return f"Wait until {full_date.isoformat() if full_date else 'a later safe date'} to pay in full. Paying today would leave only {currency} {fmt_amount(amount)} safely available."
    if changes != "none":
        return f"Proceed only with the listed flexible spending change. Without that adjustment, the request would put the {currency} {fmt_amount(min_keep)} minimum at risk."
    return f"Do not proceed by the requested date. Only {currency} {fmt_amount(amount)} is safe today, and no eligible plan protects the {currency} {fmt_amount(min_keep)} minimum."


def build_candidates(dataset: Dataset, request: dict, profile: dict, events: List[CashEvent], changes: Tuple[str, ...]) -> List[dict]:
    req_date = parse_date(request["request_date"])
    deadline = parse_date(request["desired_completion_date"])
    requested = parse_float(request["requested_amount"], 0.0) or 0.0
    balance = parse_float(profile["current_available_balance"], 0.0) or 0.0
    min_keep = parse_float(profile["minimum_balance_to_keep"], 0.0) or 0.0
    prefs = split_pipe(profile.get("payment_methods_user_will_consider"))
    max_months = parse_float(profile.get("max_installment_months"), None)
    safe_now = safe_amount_today(events, req_date, balance, min_keep, requested)
    full_date = first_safe_full_date(events, req_date, balance, min_keep, requested)
    change_text = "|".join(changes) if changes else "none"
    candidates = []

    if "full_payment" in prefs:
        payments = [(req_date, requested)]
        ok, low, _ = forecast_min_balance(events, req_date, balance, min_keep, payments, changes)
        if ok:
            candidates.append({"method": "full_payment", "payments": payments, "completion": req_date, "total": requested, "option_id": "0", "low": low, "changes": change_text})
        if full_date and full_date != req_date and deadline and full_date <= deadline:
            payments = [(full_date, requested)]
            ok, low, _ = forecast_min_balance(events, req_date, balance, min_keep, payments, changes)
            if ok:
                candidates.append({"method": "wait", "payments": payments, "completion": full_date, "total": requested, "option_id": "0", "low": low, "changes": change_text})

    if request.get("allows_partial_payment", "").lower() == "true" and "partial_payment" in prefs and 0 < safe_now < requested and full_date and deadline and full_date <= deadline:
        payments = [(req_date, safe_now), (full_date, requested - safe_now)]
        ok, low, _ = forecast_min_balance(events, req_date, balance, min_keep, payments, changes)
        if ok:
            candidates.append({"method": "partial_payment", "payments": payments, "completion": full_date, "total": requested, "option_id": "0", "low": low, "changes": change_text})

    if "installments" in prefs:
        for option in dataset.options_by_request[request["request_id"]]:
            if option.get("payment_method") != "installments":
                continue
            payments = option_schedule(option)
            if not payments:
                continue
            months = len(payments)
            if max_months is not None and months > max_months:
                continue
            completion = payments[-1][0]
            if deadline and completion > deadline:
                continue
            ok, low, _ = forecast_min_balance(events, req_date, balance, min_keep, payments, changes)
            if ok:
                candidates.append({
                    "method": "installments",
                    "payments": payments,
                    "completion": completion,
                    "total": parse_float(option.get("total_payable_amount"), sum(v for _, v in payments)) or sum(v for _, v in payments),
                    "option_id": option["payment_option_id"],
                    "low": low,
                    "changes": change_text,
                })

    return candidates


def rank(candidates: List[dict], deadline: date) -> List[dict]:
    def option_num(value: str) -> int:
        digits = "".join(ch for ch in value if ch.isdigit())
        return int(digits or "0")

    return sorted(
        candidates,
        key=lambda c: (
            0 if c["completion"] <= deadline else 1,
            0 if c["changes"] == "none" else 1,
            round(c["total"], 2),
            c["payments"][0][0],
            len(c["payments"]),
            option_num(c["option_id"]),
        ),
    )


def validate_row(row: dict, request: dict, dataset: Dataset) -> None:
    requested = parse_float(request["requested_amount"], 0.0) or 0.0
    safe = parse_float(row["amount_safe_to_pay"], 0.0) or 0.0
    if safe < -0.005 or safe > requested + 0.005:
        raise ValueError(f"{request['request_id']} safe amount out of bounds")
    if list(row.keys()) != OUTPUT_COLUMNS:
        raise ValueError("output columns are not in the required order")
    if row["recommended_payment_method"] == "installments":
        plans = {plan_text(option_schedule(o)) for o in dataset.options_by_request[request["request_id"]] if o.get("payment_method") == "installments"}
        if row["payment_plan"] not in plans:
            raise ValueError(f"{request['request_id']} installment plan does not match an option")
    if row["affordability_status"] == "affordable_now" and row["earliest_date_for_full_payment"] != request["request_date"]:
        raise ValueError(f"{request['request_id']} affordable_now date mismatch")


def build_row(dataset: Dataset, request: dict, profile: dict, events: List[CashEvent]) -> Tuple[dict, dict]:
    """Deterministic forecast -> candidates -> rank -> compose, pre-validation.

    Returns (row, facts) where facts carries the numbers an explanation may
    reference (used by the graph's explanation agent to ground its text).
    """
    req_date = parse_date(request["request_date"])
    deadline = parse_date(request["desired_completion_date"])
    requested = parse_float(request["requested_amount"], 0.0) or 0.0
    balance = parse_float(profile["current_available_balance"], 0.0) or 0.0
    min_keep = parse_float(profile["minimum_balance_to_keep"], 0.0) or 0.0
    currency = profile["home_currency"]

    safe_now = safe_amount_today(events, req_date, balance, min_keep, requested)
    full_date = first_safe_full_date(events, req_date, balance, min_keep, requested)
    all_candidates = []
    for changes in candidate_spending_changes(events, profile, req_date):
        all_candidates.extend(build_candidates(dataset, request, profile, events, changes))

    ranked = rank(all_candidates, deadline) if all_candidates else []
    chosen = ranked[0] if ranked else None
    base_ok, base_low, _ = forecast_min_balance(events, req_date, balance, min_keep)

    if chosen:
        method = chosen["method"]
        if method == "full_payment" and chosen["payments"][0][0] == req_date and chosen["changes"] == "none":
            status = "affordable_now"
        elif method == "wait":
            status = "affordable_later"
        else:
            status = "affordable_with_plan"
        earliest = full_date.isoformat() if full_date else ""
        low = chosen["low"]
        changes = chosen["changes"]
        plan = plan_text(chosen["payments"])
    else:
        method = "not_recommended"
        status = "affordable_later" if full_date and full_date <= deadline and "full_payment" in split_pipe(profile.get("payment_methods_user_will_consider")) else "not_affordable"
        plan = plan_text([(full_date, requested)]) if status == "affordable_later" and full_date else "none"
        earliest = full_date.isoformat() if full_date else ""
        low = base_low
        changes = "none"

    row = {
        "request_id": request["request_id"],
        "amount_safe_to_pay": fmt_amount(safe_now),
        "affordability_status": status,
        "recommended_payment_method": method if chosen else ("wait" if status == "affordable_later" else "not_recommended"),
        "payment_plan": plan,
        "earliest_date_for_full_payment": earliest,
        "spending_changes_needed": changes,
        "decision_explanation": explain(currency, status, method if chosen else "wait", safe_now, requested, low, min_keep, full_date, changes),
    }
    facts = {
        "currency": currency,
        "status": status,
        "method": row["recommended_payment_method"],
        "amount_safe_to_pay": safe_now,
        "requested_amount": requested,
        "forecast_low": low,
        "min_balance_to_keep": min_keep,
        "earliest_date_for_full_payment": earliest,
        "spending_changes_needed": changes,
    }
    return row, facts


def decide(dataset: Dataset, request: dict, raw_events_override: Optional[List[dict]] = None) -> dict:
    profile = dataset.profiles[request["user_id"]]
    req_date = parse_date(request["request_date"])
    currency = profile["home_currency"]
    events = build_cash_events(dataset, request["user_id"], currency, req_date, raw_events=raw_events_override)
    row, _facts = build_row(dataset, request, profile, events)
    validate_row(row, request, dataset)
    return row


def write_usage_report(total_requests: int) -> None:
    report = (
        "# Token Usage & Cost Report\n\n"
        "## Per-model breakdown\n"
        "| Model | Calls | Input tokens | Output tokens | Total tokens | Est. cost |\n"
        "|---|---|---|---|---|---|\n"
        "| deterministic-rules | 0 | 0 | 0 | 0 | $0.0000 |\n\n"
        "## Overall\n"
        "- Total calls: 0\n"
        "- Total tokens: 0\n"
        "- Total estimated cost: $0.0000\n"
        f"- Requests processed: {total_requests}\n"
        "- Avg tokens / request: 0.00\n"
        "- Avg cost / request: $0.0000\n"
    )
    for eval_dir in (BASE_DIR / "backend" / "evaluation", BASE_DIR / "evaluation"):
        eval_dir.mkdir(parents=True, exist_ok=True)
        (eval_dir / "usage_report.md").write_text(report, encoding="utf-8")


def main() -> None:
    dataset = Dataset()
    rows = [decide(dataset, request) for request in dataset.requests]
    with open(BASE_DIR / "output.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    write_usage_report(len(rows))
    print(f"Wrote {len(rows)} predictions to {BASE_DIR / 'output.csv'}")


if __name__ == "__main__":
    main()
