import json

def write_explanation(extraction_service, decision_trace, usage_logger=None):
    """
    Generates a deterministic explanation using the LLM.
    We batch this conceptually, but this signature is for one trace.
    In a real batch scenario, we'd send a list of traces and ask for a JSON array back.
    """
    system_prompt = '''You write short, factual explanations for an affordability decision. You are
given a JSON "decision trace" — the request, the chosen plan, the key balance
figures, and the deciding constraint. You are NOT given raw data and must not
introduce any fact, number, or date that isn't in the trace.

Write 1–3 plain sentences that:
- state the recommendation,
- name the specific constraint that drove it (e.g. minimum balance, an
  upcoming essential expense, income timing, a required spending change),
- avoid hedging ("might," "probably") — state it as the forecast shows it.

Return plain text only, no JSON, no preamble.'''

    # We use _call_llm which expects JSON. 
    # For a plain text explanation, we might bypass the json.loads inside _call_llm.
    # To adapt, we can ask the LLM to return JSON {"explanation": "..."} to reuse the wrapper.
    adapted_prompt = system_prompt.replace('Return plain text only, no JSON, no preamble.', 'Return strict JSON only: {"explanation": "<string>"}')
    
    result = extraction_service._call_llm(
        system_prompt=adapted_prompt,
        user_prompt=json.dumps(decision_trace),
        item_id=f"explain_{decision_trace.get('request_id', 'unknown')}",
        usage_logger=usage_logger
    )
    
    return result.get('explanation', 'Based on financial constraints, this plan is recommended.')
