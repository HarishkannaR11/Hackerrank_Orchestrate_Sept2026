def rank_plans(candidates, desired_completion_date):
    """
    Ranks plans based on:
    (1) completes by desired_completion_date
    (2) no spending changes
    (3) lowest total paid
    (4) earliest start
    (5) fewest payments
    (6) lowest payment_option_id
    """
    def rank_key(plan):
        completes_in_time = 0 if (plan['completion_date'] <= desired_completion_date) else 1
        no_spending_changes = 0 if not plan.get('spending_changes') else 1
        total_paid = plan.get('total_amount_paid', float('inf'))
        start_date = plan.get('start_date', '9999-12-31')
        num_payments = plan.get('num_payments', float('inf'))
        option_id = plan.get('payment_option_id', float('inf'))
        
        return (
            completes_in_time,
            no_spending_changes,
            total_paid,
            start_date,
            num_payments,
            option_id
        )
        
    return sorted(candidates, key=rank_key)

def build_candidates(request, amount_safe, full_safe_date):
    """
    Generates available candidate plans based on safety parameters.
    """
    candidates = []
    
    if amount_safe >= request['requested_amount']:
        candidates.append({
            'method': 'full_payment',
            'completion_date': request['request_date'], # assuming today
            'total_amount_paid': request['requested_amount'],
            'start_date': request['request_date'],
            'num_payments': 1,
            'payment_option_id': 0
        })
    elif amount_safe > 0:
        candidates.append({
            'method': 'partial_payment',
            'completion_date': full_safe_date or '9999-12-31',
            'total_amount_paid': request['requested_amount'],
            'start_date': request['request_date'],
            'num_payments': 2,
            'payment_option_id': 0
        })
        
    # Wait option
    if full_safe_date:
        candidates.append({
            'method': 'wait',
            'completion_date': full_safe_date,
            'total_amount_paid': request['requested_amount'],
            'start_date': full_safe_date,
            'num_payments': 1,
            'payment_option_id': 0
        })
        
    return candidates
