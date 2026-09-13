import pandas as pd
from datetime import timedelta

def _as_date(value):
    if hasattr(value, "date") and not hasattr(value, "day"):
        return value.date()
    return pd.to_datetime(value).date()

def _event_date(event):
    return _as_date(event.get('settlement_date') or event.get('event_date') or event.get('date'))

def _amount(event):
    value = event.get('amount', 0)
    if pd.isna(value):
        return 0.0
    return float(value)

def run_forecast(ledger, start_date, starting_balance, min_balance, spending_changes=None):
    """
    Simulates daily balance over 90 days.
    Returns {"safe": bool, "fail_date": date_str, "min_balance": float}
    """
    spending_changes = spending_changes or []
    start_date = _as_date(start_date)
    balance = starting_balance
    min_recorded_balance = balance
    changes_by_event = {}
    for change in spending_changes:
        parts = str(change).split(':')
        if len(parts) >= 2:
            changes_by_event[parts[1]] = parts

    events_by_day = {}
    rows = ledger if isinstance(ledger, list) else ledger.to_dict(orient='records')
    for event in rows:
        status = event.get('status', '')
        if status in {'failed', 'cancelled', 'unrealized'}:
            continue
        if status == 'pending' and event.get('direction') == 'credit':
            continue
        try:
            event_day = _event_date(event)
        except Exception:
            continue
        if not (start_date <= event_day <= start_date + timedelta(days=90)):
            continue
        amount = _amount(event)
        parts = changes_by_event.get(event.get('event_id'))
        if parts:
            if parts[0] == 'stop':
                amount = 0
            elif parts[0] == 'reduce_to' and len(parts) == 3:
                amount = min(amount, float(parts[2]))
        signed = amount if event.get('direction') == 'credit' else -amount
        events_by_day[event_day] = events_by_day.get(event_day, 0.0) + signed

    for day_offset in range(91):
        current_date = start_date + timedelta(days=day_offset)
        balance += events_by_day.get(current_date, 0.0)
        
        if balance < min_recorded_balance:
            min_recorded_balance = balance
            
        if balance < min_balance:
            return {"safe": False, "fail_date": current_date.strftime("%Y-%m-%d"), "min_balance": min_recorded_balance}
            
    return {"safe": True, "fail_date": None, "min_balance": min_recorded_balance}

def find_amount_safe_to_pay(ledger, start_date, starting_balance, min_balance, requested_amount, spending_changes=None):
    """
    Finds the maximum safe amount to pay today.
    Uses binary search if no spending changes, otherwise stepped/linear search.
    """
    if not spending_changes:
        # Analytical/Monotonic approach
        forecast = run_forecast(ledger, start_date, starting_balance, min_balance)
        if forecast['safe']:
            # If completely safe without paying anything, the safe amount is the buffer
            buffer = forecast['min_balance'] - min_balance
            return min(buffer, requested_amount)
        return 0
    else:
        low, high = 0.0, float(requested_amount)
        for _ in range(32):
            current_test = (low + high) / 2
            forecast = run_forecast(ledger, start_date, starting_balance - current_test, min_balance, spending_changes)
            if forecast['safe']:
                low = current_test
            else:
                high = current_test
        return round(low, 2)
