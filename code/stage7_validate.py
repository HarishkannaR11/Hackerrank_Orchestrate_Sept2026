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
    safe_date = row.get('earliest_date_for_full_payment')
    
    if status == 'affordable_now':
        req_date = str(request['request_date']).split()[0] if hasattr(request['request_date'], 'split') else str(request['request_date'].date())
        # The prompt says affordable_now <=> earliest_date == request_date
        # We enforce it here (loosely since types might mismatch, assume string comparison)
        if str(safe_date) != str(req_date):
            raise ValueError(f"affordable_now requires earliest_date == request_date ({safe_date} != {req_date})")
            
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
