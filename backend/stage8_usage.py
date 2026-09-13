import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
USAGE_REPORT_PATH = BASE_DIR / 'backend' / 'evaluation' / 'usage_report.md'
USAGE_DATA_PATH = BASE_DIR / 'backend' / 'evaluation' / 'usage_data.json'

class UsageLogger:
    def __init__(self):
        self.models = {}
        self.fallbacks = []
        # Pricing approximations
        self.prices = {
            "claude-3-5-sonnet-20240620": {"input": 3.0 / 1_000_000, "output": 15.0 / 1_000_000}
        }
        
    def log_call(self, model: str, input_tokens: int, output_tokens: int):
        if model not in self.models:
            self.models[model] = {'calls': 0, 'input_tokens': 0, 'output_tokens': 0}
        self.models[model]['calls'] += 1
        self.models[model]['input_tokens'] += input_tokens
        self.models[model]['output_tokens'] += output_tokens
        
    def log_fallback(self, request_id: str, fallback_type: str, reason: str):
        self.fallbacks.append({"request_id": request_id, "type": fallback_type, "reason": reason})

    def generate_report(self, total_requests: int):
        total_calls = 0
        total_tokens = 0
        total_cost = 0.0
        
        markdown = "# Token Usage & Cost Report\n\n## Per-model breakdown\n"
        markdown += "| Model | Calls | Input tokens | Output tokens | Total tokens | Est. cost |\n"
        markdown += "|---|---|---|---|---|---|\n"
        
        for model, data in self.models.items():
            calls = data['calls']
            in_t = data['input_tokens']
            out_t = data['output_tokens']
            tot_t = in_t + out_t
            
            price_in = self.prices.get(model, {"input": 0.0})['input']
            price_out = self.prices.get(model, {"output": 0.0})['output']
            
            cost = (in_t * price_in) + (out_t * price_out)
            
            total_calls += calls
            total_tokens += tot_t
            total_cost += cost
            
            markdown += f"| {model} | {calls} | {in_t} | {out_t} | {tot_t} | ${cost:.4f} |\n"
            
        avg_tokens = total_tokens / total_requests if total_requests else 0
        avg_cost = total_cost / total_requests if total_requests else 0
        
        markdown += "\n## Overall\n"
        markdown += f"- Total calls: {total_calls}\n"
        markdown += f"- Total tokens: {total_tokens}\n"
        markdown += f"- Total estimated cost: ${total_cost:.4f}\n"
        markdown += f"- Requests processed: {total_requests}\n"
        markdown += f"- Avg tokens / request: {avg_tokens:.2f}\n"
        markdown += f"- Avg cost / request: ${avg_cost:.4f}\n"
        
        USAGE_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(USAGE_REPORT_PATH, 'w') as f:
            f.write(markdown)
            
        with open(USAGE_DATA_PATH, 'w') as f:
            json.dump({
                "models": [{"name": k, **v} for k, v in self.models.items()],
                "summary": {
                    "total_calls": total_calls,
                    "total_tokens": total_tokens,
                    "total_cost": total_cost,
                    "requests_processed": total_requests
                },
                "raw_markdown": markdown
            }, f, indent=2)
