import re

# Deterministic guard against prompt injection in untrusted message/image content.
INJECTION_PATTERN = re.compile(
    r"(?i)(ignore (all |previous |your )?instructions|system:|you are now|"
    r"forget (all|everything)|override (the )?rules|act as|disregard|"
    r"new instructions|do not (follow|apply) the (problem|rules))"
)


def check_injection(text: str | None) -> bool:
    """Returns True if text matches a known prompt-injection pattern."""
    if not text:
        return False
    return bool(INJECTION_PATTERN.search(text))
