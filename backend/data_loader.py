import pandas as pd
import json
import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'dataset'
CACHE_FILE = BASE_DIR / 'backend' / 'llm_cache.json'

class DataLoader:
    def __init__(self):
        self.requests = None
        self.profiles = None
        self.events = None
        self.payment_options = None
        self.exchange_rates = None
        self.messages = None
        self.images = None
        
        self.load_all()

    def load_all(self):
        self.requests = pd.read_csv(DATA_DIR / 'requests.csv')
        self.profiles = pd.read_csv(DATA_DIR / 'financial_profiles.csv')
        self.events = pd.read_csv(DATA_DIR / 'financial_events.csv')
        self.payment_options = pd.read_csv(DATA_DIR / 'request_payment_options.csv')
        self.exchange_rates = pd.read_csv(DATA_DIR / 'exchange_rates.csv')
        self.messages = pd.read_csv(DATA_DIR / 'messages.csv')
        self.images = pd.read_csv(DATA_DIR / 'images.csv')
        
        # Preprocessing exchange rates to handle fallbacks
        self.exchange_rates['rate_date'] = pd.to_datetime(self.exchange_rates['rate_date'])
        self.exchange_rates = self.exchange_rates.sort_values('rate_date')

    def get_exchange_rate(self, date_str, from_currency, to_currency):
        if from_currency == to_currency:
            return 1.0
            
        target_date = pd.to_datetime(date_str)
        # Find rates for this currency pair
        pair_rates = self.exchange_rates[
            (self.exchange_rates['from_currency'] == from_currency) & 
            (self.exchange_rates['to_currency'] == to_currency)
        ]
        
        if pair_rates.empty:
            raise ValueError(f"No exchange rates found for pair {from_currency} -> {to_currency}")
            
        # Get rate for date or most recent prior date (forward fill fallback)
        past_rates = pair_rates[pair_rates['rate_date'] <= target_date]
        if not past_rates.empty:
            return past_rates.iloc[-1]['rate']
        
        # If no prior rate, take the earliest available
        return pair_rates.iloc[0]['rate']


class LLMCache:
    def __init__(self, cache_file=CACHE_FILE):
        self.cache_file = cache_file
        self.cache = self._load_cache()

    def _load_cache(self):
        if self.cache_file.exists():
            with open(self.cache_file, 'r') as f:
                return json.load(f)
        return {}

    def _save_cache(self):
        with open(self.cache_file, 'w') as f:
            json.dump(self.cache, f, indent=2)

    def get(self, item_id, model_version):
        key = f"{item_id}_{model_version}"
        return self.cache.get(key)

    def set(self, item_id, model_version, value):
        key = f"{item_id}_{model_version}"
        self.cache[key] = value
        self._save_cache()

if __name__ == '__main__':
    loader = DataLoader()
    print("Successfully loaded datasets.")
    print("Exchange rate test:", loader.get_exchange_rate('2026-09-01', 'USD', 'EUR'))
