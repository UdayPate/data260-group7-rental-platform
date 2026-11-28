"""Language-model calls: routing, the semantic cache, and the call log (slide 6, guide step 11).

Where a model is used, and where it is NOT:
  - Request Parser: the rule-based parser (scoring.parse_request) always runs. A model may FILL
    fields the rules left empty (e.g. "next weekend"), never overwrite them. Its JSON is validated
    (harness.Requirements) before use; anything unusable is ignored.
  - Explanation agent: a model may write the plain-language `rationale` from the measured facts.
  - Never: scores, rankings, votes, evidence. Those are code over the database (scoring.py).

Without ANTHROPIC_API_KEY every call falls back to the rules / the template, so the demo works
offline and free. The call is still logged (model "rules-only"), so request counts stay comparable.

Routing rule (small vs frontier, frontier ~10x the cost):
  frontier when the request is long (> 160 characters), or the rules found few of the usual fields,
  or it uses vague time words ("next weekend", "in March"); otherwise small.

Semantic cache (SEMANTIC_CACHE=on|off): the normalised request text is embedded (a small hashed
bag-of-words, no extra service needed) and compared by cosine similarity. A hit needs similarity
>= SEMANTIC_CACHE_THRESHOLD (0.95) AND the same nights, guests, explicit dates, budget and rating
as the rules read them, so "2 nights for 2" never reuses "3 nights for 4". Only the model's parsed
fields are cached, never a whole recommendation (availability changes).

Logs for Rohini and Shashank (MongoDB):
  model_calls           { trace_id, purpose, tier, model, input_tokens, output_tokens, latency_ms,
                          cost_estimate, cached, ok, error, timestamp }
  semantic_cache_stats  { trace_id, hit, similarity, latency_ms, timestamp }
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import time
from typing import Any, Callable

from xenia_shared.config import env_flag, env_float, env_str
from xenia_shared.timeutil import iso_millis

from .store import db

log = logging.getLogger("xenia.ai.llm")

# Cost per 1,000 tokens in made-up "units": only the ratio matters (frontier = 10x small).
COST_PER_1K = {"small": 0.001, "frontier": 0.01, "rules-only": 0.0}
VAGUE_TIME = re.compile(r"\b(next|this|coming)\s+(week|weekend|month)|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|tomorrow|tonight", re.I)


def model_name(tier: str) -> str:
    return env_str("AI_FRONTIER_MODEL", "claude-sonnet-5-5") if tier == "frontier" else env_str("AI_SMALL_MODEL", "claude-haiku-5-5")


def route(text: str, rules_found: int) -> str:
    """Which model tier a parsing request needs. rules_found = how many of the usual fields the rules read."""
    if len(text) > 160 or rules_found < 3 or VAGUE_TIME.search(text):
        return "frontier"
    return "small"


# ------------------------------------------------------------------ the model client
# Tests replace this with a fake: fn(model, system, prompt) -> (text, input_tokens, output_tokens)
_client_override: Callable[[str, str, str], tuple[str, int, int]] | None = None


def set_client(fn: Callable[[str, str, str], tuple[str, int, int]] | None) -> None:
    global _client_override
    _client_override = fn


def model_available() -> bool:
    return _client_override is not None or bool(env_str("ANTHROPIC_API_KEY", ""))


def _anthropic_call(model: str, system: str, prompt: str) -> tuple[str, int, int]:
    import anthropic  # imported here: the service runs without it when there is no API key

    client = anthropic.Anthropic(timeout=env_float("AI_MODEL_TIMEOUT_SECONDS", 8.0), max_retries=1)
    reply = client.messages.create(model=model, max_tokens=600, system=system, messages=[{"role": "user", "content": prompt}])
    text = "".join(block.text for block in reply.content if getattr(block, "type", "") == "text")
    return text, reply.usage.input_tokens, reply.usage.output_tokens


def log_call(trace_id: str, purpose: str, tier: str, model: str, started: float, tokens_in: int = 0, tokens_out: int = 0,
             cached: bool = False, ok: bool = True, error: str | None = None) -> None:
    try:
        db().model_calls.insert_one({
            "trace_id": trace_id, "purpose": purpose, "tier": tier, "model": model,
            "input_tokens": tokens_in, "output_tokens": tokens_out,
            "latency_ms": round((time.monotonic() - started) * 1000, 1),
            "cost_estimate": round((tokens_in + tokens_out) / 1000 * COST_PER_1K.get(tier, 0), 6),
            "cached": cached, "ok": ok, "error": error, "timestamp": iso_millis(),
        })
    except Exception as problem:  # noqa: BLE001  (logging must never break a debate)
        log.warning("could not log a model call: %s", problem)


def complete(trace_id: str, purpose: str, tier: str, system: str, prompt: str) -> str | None:
    """One model call. Returns the text, or None (no API key, error or timeout: the caller falls back)."""
    started = time.monotonic()
    if not model_available():
        log_call(trace_id, purpose, "rules-only", "rules-only (no ANTHROPIC_API_KEY)", started)
        return None
    model = model_name(tier)
    try:
        text, tokens_in, tokens_out = (_client_override or _anthropic_call)(model, system, prompt)
    except Exception as problem:  # noqa: BLE001
        log_call(trace_id, purpose, tier, model, started, ok=False, error=f"{type(problem).__name__}: {problem}"[:300])
        return None
    log_call(trace_id, purpose, tier, model, started, tokens_in, tokens_out)
    return text


def extract_json(text: str | None) -> Any:
    """The first {...} object in a model reply, or None."""
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except ValueError:
        return None


# ------------------------------------------------------------------ the semantic cache
DIMENSIONS = 512


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w$.≥<=-]+", " ", text.lower())).strip()


def embed(text: str) -> list[float]:
    """A tiny local embedding: hashed words, word pairs and 3-letter pieces, scaled to length 1.
    Good enough to spot the same request written slightly differently; no external service."""
    words = normalise(text).split()
    features = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
    joined = " ".join(words)
    features += [joined[i:i + 3] for i in range(max(len(joined) - 2, 0))]
    vector = [0.0] * DIMENSIONS
    for feature in features:
        digest = hashlib.md5(feature.encode()).digest()
        index = int.from_bytes(digest[:4], "little") % DIMENSIONS
        vector[index] += 1.0 if digest[4] % 2 else -1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def cache_enabled() -> bool:
    return env_flag("SEMANTIC_CACHE", True)


def cache_lookup(trace_id: str, text: str, guard: dict[str, Any]) -> dict[str, Any] | None:
    """The cached model fields for a similar enough request with the same guard values, or None."""
    if not cache_enabled():
        return None
    started = time.monotonic()
    vector = embed(text)
    best, best_similarity = None, 0.0
    for entry in db().semantic_cache.find({"guard": guard}):
        similarity = cosine(vector, entry["embedding"])
        if similarity > best_similarity:
            best, best_similarity = entry, similarity
    hit = best is not None and best_similarity >= env_float("SEMANTIC_CACHE_THRESHOLD", 0.95)
    db().semantic_cache_stats.insert_one({
        "trace_id": trace_id, "hit": hit, "similarity": round(best_similarity, 4),
        "latency_ms": round((time.monotonic() - started) * 1000, 2), "timestamp": iso_millis(),
    })
    return best["fields"] if hit else None


def cache_store(text: str, guard: dict[str, Any], fields: dict[str, Any]) -> None:
    if cache_enabled():
        db().semantic_cache.insert_one({"text": normalise(text), "embedding": embed(text), "guard": guard, "fields": fields, "timestamp": iso_millis()})
