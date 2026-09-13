def validate_row(row, request):
    """
    Validates a generated output row.
    Raises ValueError if invalid, which triggers a retry in the main pipeline.
    """
    safe_amount = row.get('amount_safe_to_pay', 0)
    requested = request.get('requested_amount', 0)
    
    if not (0 <= safe_amount <= requested):
        raise ValueError(f"amount_safe_to_pay ({safe_amount}) must be between 0 and {requested}")
        
    status = row.get('affordability_status')
    method = row.get('recommended_payment_method')
    payment_plan = row.get('payment_plan')
    safe_date = row.get('earliest_date_for_full_payment')

    valid_statuses = {'affordable_now', 'affordable_with_plan', 'affordable_later', 'not_affordable'}
    valid_methods = {'full_payment', 'partial_payment', 'installments', 'wait', 'not_recommended'}
    if status not in valid_statuses:
        raise ValueError(f"Invalid affordability_status: {status}")
    if method not in valid_methods:
        raise ValueError(f"Invalid recommended_payment_method: {method}")
    if not payment_plan:
        raise ValueError("payment_plan must be present; use 'none' when no payment is recommended")
    
    if status == 'affordable_now':
        req_date = str(request['request_date']).split()[0] if hasattr(request['request_date'], 'split') else str(request['request_date'].date())
        # The prompt says affordable_now <=> earliest_date == request_date
        # We enforce it here (loosely since types might mismatch, assume string comparison)
        if str(safe_date) != str(req_date):
            raise ValueError(f"affordable_now requires earliest_date == request_date ({safe_date} != {req_date})")

    if method == 'partial_payment':
        if status != 'affordable_with_plan':
            raise ValueError("partial_payment requires affordable_with_plan")
        if payment_plan == 'none' or len(payment_plan.split('|')) != 2:
            raise ValueError("partial_payment must have exactly two payments")

    if method == 'not_recommended' and payment_plan != 'none':
        raise ValueError("not_recommended must not include a payment plan")

    changes = row.get('spending_changes_needed', 'none')
    if changes != 'none':
        for change in changes.split('|'):
            parts = change.split(':')
            if parts[0] not in {'stop', 'reduce_to'}:
                raise ValueError(f"Invalid spending change: {change}")
            if parts[0] == 'stop' and len(parts) != 2:
                raise ValueError(f"Invalid stop change: {change}")
            if parts[0] == 'reduce_to' and len(parts) != 3:
                raise ValueError(f"Invalid reduce_to change: {change}")
            
    # Can add more rules based on payment_plan matching etc.
    return True
    
def get_safe_fallback(request_id):
    return {
        "request_id": request_id,
        "amount_safe_to_pay": 0,
        "affordability_status": "not_affordable",
        "recommended_payment_method": "not_recommended",
        "payment_plan": "none",
        "earliest_date_for_full_payment": None,
        "spending_changes_needed": "none",
        "decision_explanation": "Defaulted to safe fallback due to validation failure."
    }
