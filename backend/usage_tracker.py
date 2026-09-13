from __future__ import annotations

from collections import defaultdict
from pathlib import Path

# Rough per-1M-token USD prices for cost estimation. Update if pricing changes.
PRICE_PER_1M_TOKENS = {
    "llama-3.3-70b-versatile": {"input": 0.59, "output": 0.79},
    "meta-llama/llama-4-scout-17b-16e-instruct": {"input": 0.11, "output": 0.34},
}
DEFAULT_PRICE = {"input": 0.20, "output": 0.20}


class UsageTracker:
    """Accumulates LLM call/token stats across agent nodes for the usage report."""

    def __init__(self):
        self.calls = defaultdict(int)
        self.input_tokens = defaultdict(int)
        self.output_tokens = defaultdict(int)

    def log(self, model: str, input_tokens: int, output_tokens: int) -> None:
        self.calls[model] += 1
        self.input_tokens[model] += input_tokens
        self.output_tokens[model] += output_tokens

    def _cost(self, model: str) -> float:
        price = PRICE_PER_1M_TOKENS.get(model, DEFAULT_PRICE)
        return (
            self.input_tokens[model] / 1_000_000 * price["input"]
            + self.output_tokens[model] / 1_000_000 * price["output"]
        )

    def total_cost(self) -> float:
        return sum(self._cost(model) for model in self.calls)

    def as_models_list(self) -> list[dict]:
        return [
            {
                "name": model,
                "calls": self.calls[model],
                "input_tokens": self.input_tokens[model],
                "output_tokens": self.output_tokens[model],
                "total_tokens": self.input_tokens[model] + self.output_tokens[model],
                "cost": round(self._cost(model), 6),
            }
            for model in sorted(self.calls)
        ]

    def write_report(self, path: Path, total_requests: int) -> None:
        models = sorted(self.calls.keys())
        lines = ["# Token Usage & Cost Report\n", "## Per-model breakdown\n"]
        lines.append("| Model | Calls | Input tokens | Output tokens | Total tokens | Est. cost |")
        lines.append("|---|---|---|---|---|---|")

        total_calls = total_input = total_output = 0
        total_cost = 0.0
        for model in models:
            calls = self.calls[model]
            inp = self.input_tokens[model]
            out = self.output_tokens[model]
            cost = self._cost(model)
            lines.append(f"| {model} | {calls} | {inp} | {out} | {inp + out} | ${cost:.4f} |")
            total_calls += calls
            total_input += inp
            total_output += out
            total_cost += cost

        if not models:
            lines.append("| (no LLM calls made) | 0 | 0 | 0 | 0 | $0.0000 |")

        total_tokens = total_input + total_output
        lines.append("")
        lines.append("## Overall")
        lines.append(f"- Model providers: Groq (via langchain-groq)" if models else "- Model providers: none (deterministic-only run)")
        lines.append(f"- Total calls: {total_calls}")
        lines.append(f"- Total input tokens: {total_input}")
        lines.append(f"- Total output tokens: {total_output}")
        lines.append(f"- Total tokens: {total_tokens}")
        lines.append(f"- Total estimated cost: ${total_cost:.4f}")
        lines.append(f"- Requests processed: {total_requests}")
        lines.append(f"- Avg tokens / request: {total_tokens / total_requests:.2f}" if total_requests else "- Avg tokens / request: 0.00")
        lines.append(f"- Avg cost / request: ${total_cost / total_requests:.4f}" if total_requests else "- Avg cost / request: $0.0000")

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
