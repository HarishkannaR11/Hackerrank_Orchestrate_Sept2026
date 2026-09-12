import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'dataset'

def load_data():
    """
    Loads all datasets, parses dates, and groups requests and events by user_id.
    """
    data = {
        'requests': pd.read_csv(DATA_DIR / 'requests.csv'),
        'profiles': pd.read_csv(DATA_DIR / 'financial_profiles.csv'),
        'events': pd.read_csv(DATA_DIR / 'financial_events.csv'),
        'payment_options': pd.read_csv(DATA_DIR / 'request_payment_options.csv'),
        'exchange_rates': pd.read_csv(DATA_DIR / 'exchange_rates.csv'),
        'messages': pd.read_csv(DATA_DIR / 'messages.csv'),
        'images': pd.read_csv(DATA_DIR / 'images.csv')
    }

    # Date parsing
    data['exchange_rates']['rate_date'] = pd.to_datetime(data['exchange_rates']['rate_date'])
    data['exchange_rates'] = data['exchange_rates'].sort_values('rate_date')
    
    # Optional date parsing for other data if needed
    for date_col in ['request_date', 'desired_completion_date']:
        if date_col in data['requests'].columns:
            data['requests'][date_col] = pd.to_datetime(data['requests'][date_col])

    return data

def get_exchange_rate(exchange_rates_df, date_str, from_currency, to_currency, usage_logger=None, request_id=None):
    """
    Returns the exchange rate for a given date.
    Implements a forward-fill fallback if the exact date is missing.
    Logs to the usage_logger if a fallback is used.
    """
    if from_currency == to_currency:
        return 1.0
        
    target_date = pd.to_datetime(date_str)
    
    pair_rates = exchange_rates_df[
        (exchange_rates_df['from_currency'] == from_currency) & 
        (exchange_rates_df['to_currency'] == to_currency)
    ]
    
    if pair_rates.empty:
        raise ValueError(f"No exchange rates found for pair {from_currency} -> {to_currency}")
        
    # Exact match check
    exact_match = pair_rates[pair_rates['rate_date'] == target_date]
    if not exact_match.empty:
        return exact_match.iloc[0]['rate']
        
    # Forward-fill fallback
    past_rates = pair_rates[pair_rates['rate_date'] < target_date]
    
    if usage_logger and request_id:
        usage_logger.log_fallback(request_id, "rate_fallback_used", f"Missing rate for {from_currency}->{to_currency} on {date_str}")
        
    if not past_rates.empty:
        return past_rates.iloc[-1]['rate']
    
    # If no prior rate, take the earliest available
    return pair_rates.iloc[0]['rate']

def get_user_data(data, user_id):
    """
    Returns all relevant data indices for a specific user_id.
    """
    return {
        'profile': data['profiles'][data['profiles']['user_id'] == user_id],
        'events': data['events'][data['events']['user_id'] == user_id],
        'messages': data['messages'][data['messages']['user_id'] == user_id],
        'images': data['images'][data['images']['user_id'] == user_id]
    }
