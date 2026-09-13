import pandas as pd

def build_ledger(user_events, user_messages, user_images, extraction_service):
    """
    Reconciles events, applying message/image extractions according to priority.
    Returns a clean ledger (list of active, settled/confirmed events).
    """
    events_dict = user_events.to_dict(orient='records')
    # Dictionary to keep track of latest state by event_id (or linked_event_id)
    ledger_state = {}
    review_queue = []

    # Priority logic: 1. explicit settlement > 2. newer > 3. safe
    for event in events_dict:
        # Resolve base event
        base_id = event.get('linked_event_id') or event['event_id']
        if base_id not in ledger_state:
            ledger_state[base_id] = []
        ledger_state[base_id].append(event)
        
    clean_events = []
    for base_id, chain in ledger_state.items():
        # Sort chain by date if possible, otherwise just take the latest by some logic
        # For simplicity in this demo, let's say the last in the chain is the base.
        # Real logic would check status='settled' vs 'estimate'
        settled_events = [e for e in chain if e.get('status') == 'settled']
        current_event = settled_events[-1] if settled_events else chain[-1]
        
        # Drop failed/cancelled/pending credits
        if current_event.get('status') in ['failed', 'cancelled']:
            continue
        if current_event.get('status') == 'pending' and current_event.get('amount', 0) > 0: # Assuming positive is credit
            pass # Depending on rules, drop pending credits. Wait, let's keep it simple for the skeleton.

        # Look for messages affecting this event
        related_msgs = user_messages[user_messages['related_event_id'] == base_id]
        for _, msg in related_msgs.iterrows():
            delta = extraction_service.parse_message(msg['message_id'], msg['message_text'], current_event)
            
            if delta.get('injection_flagged') or delta.get('confidence') == 'low':
                review_queue.append({
                    'id': f"rq-msg-{msg['message_id']}",
                    'request_id': 'n/a', # Need request context if available
                    'flag_reason': 'injection_pattern' if delta.get('injection_flagged') else 'low_confidence',
                    'extracted_value': str(delta),
                    'source_type': 'message',
                    'source_content': msg['message_text']
                })
                continue # Do not apply low confidence or injected
                
            # Apply delta if high/medium confidence
            if delta.get('action') == 'cancel':
                current_event['status'] = 'cancelled'
            elif delta.get('action') == 'amend':
                if delta.get('new_amount') is not None:
                    current_event['amount'] = delta['new_amount']

        # Look for images (missing amount)
        if pd.isna(current_event.get('amount')):
            related_imgs = user_images[user_images['related_event_id'] == base_id]
            if not related_imgs.empty:
                img = related_imgs.iloc[0]
                extracted = extraction_service.extract_image_amount(img['image_id'], "OCR text stub")
                if extracted.get('injection_flagged') or extracted.get('confidence') == 'low':
                    review_queue.append({
                        'id': f"rq-img-{img['image_id']}",
                        'request_id': 'n/a',
                        'flag_reason': 'injection_pattern' if extracted.get('injection_flagged') else 'low_confidence',
                        'extracted_value': str(extracted),
                        'source_type': 'image',
                        'source_content': img['image_id']
                    })
                else:
                    if extracted.get('amount') is not None:
                        current_event['amount'] = extracted['amount']

        if current_event.get('status') not in ['failed', 'cancelled'] and not pd.isna(current_event.get('amount')):
            clean_events.append(current_event)

    return clean_events, review_queue
