import pandas as pd
from datetime import timedelta

def run_forecast(ledger, start_date, starting_balance, min_balance, spending_changes=None):
    """
    Simulates daily balance over 90 days.
    Returns {"safe": bool, "fail_date": date_str, "min_balance": float}
    """
    spending_changes = spending_changes or []
    balance = starting_balance
    min_recorded_balance = balance
    
    # Very simplified forecast for skeleton
    # In reality, iterate day by day, applying income/expenses from ledger
    for day_offset in range(91):
        current_date = start_date + timedelta(days=day_offset)
        
        # Apply ledger events for this day
        # ... logic to sum income/expenses for current_date ...
        
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
        # Stepped search to avoid non-monotonic traps
        step = requested_amount / 10.0
        current_test = requested_amount
        while current_test >= 0:
            # Add the test payment to the ledger for today
            test_ledger = ledger.copy() # In reality, insert a one-time expense
            forecast = run_forecast(test_ledger, start_date, starting_balance - current_test, min_balance, spending_changes)
            if forecast['safe']:
                return current_test
            current_test -= step
            
        return 0
