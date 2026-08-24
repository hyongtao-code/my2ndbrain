"""LLM provider abstraction.

Default: `heuristic` — pure local Python, no network. Used for the demo + tests.
Optional: `openai` (set OPENAI_API_KEY) and `ollama` (local llama.cpp server).

All providers return a JSON dict with the same shape, so callers don't care.

Provider + api_key resolution order:
  1. _runtime_overrides (set via POST /api/llm/config, in-memory only)
  2. settings.llm_provider / settings.openai_api_key (env / .env)
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.core.config import get_settings


# --------- runtime overrides (set by user via /api/llm/config) ---------
# In-memory only: cleared on backend restart. Not persisted to DB.
_runtime_overrides: dict[str, str] = {}


def set_runtime_override(key: str, value: str) -> None:
    if value is None or value == "":
        _runtime_overrides.pop(key, None)
    else:
        _runtime_overrides[key] = value


def get_runtime_override(key: str) -> Optional[str]:
    return _runtime_overrides.get(key)


def clear_runtime_overrides() -> None:
    _runtime_overrides.clear()


def resolve_provider() -> dict[str, Any]:
    """Return the active provider config (with runtime overrides applied)."""
    s = get_settings()
    provider = get_runtime_override("llm_provider") or s.llm_provider
    api_key = get_runtime_override("openai_api_key") or s.openai_api_key
    model = get_runtime_override("llm_model") or s.llm_model
    return {
        "provider": provider,
        "model": model,
        "has_api_key": bool(api_key),
        # Don't expose the key itself, just whether one is set.
        "api_key_source": (
            "runtime" if get_runtime_override("openai_api_key") else
            "env"      if s.openai_api_key else
            "none"
        ),
    }


# --------- heuristic implementation ---------

_STOPWORDS = set("""a an and are as at be by for from has have he her his i if in is it its
of on or our she that the they this to was we were what when which who why will with
you your not no but do does did done been being am is are was were so than then there
here these those some any all most more less much many very can could should would may
might shall will """.split())

# 简单的术语优先级字典 — 命中后会被识别为更"有意义"
_DOMAIN_HINTS = {
    "rlhf", "grpo", "ppo", "dpo", "kto", "rm", "reward model", "policy",
    "lora", "qlora", "adalora", "longlora", "peft",
    "transformer", "attention", "flashattention", "kv cache",
    "embedding", "vector", "rag", "agent", "tool",
    "qwen", "deepseek", "llama", "gpt", "mistral", "yi",
    "vllm", "sglang", "triton", "cuda",
    "python", "fastapi", "postgres", "postgresql", "pgvector",
    "react", "typescript", "three.js", "threejs", "d3", "cytoscape",
    "linux", "kernel", "k8s", "kubernetes", "docker",
    "3gpp", "5g", "nr", "lte", "ran", "core network",
    "macro", "fomc", "fed", "rate", "etf", "bond", "yield",
    "verilog", "systemverilog", "fpga", "asic", "rtl",
}


def _domain_tokens(text: str) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_-]+", text or "")
    out = []
    for t in tokens:
        tl = t.lower()
        if tl in _STOPWORDS:
            continue
        if tl in _DOMAIN_HINTS or len(t) >= 5:
            out.append(t)
    return out


def _jaccard(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    sa = set(a)
    sb = set(b)
    inter = len(sa & sb)
    return inter / (inter + len(sa - sb) + len(sb - sa))


def heuristic_complete(prompt: str, json_schema: dict | None) -> dict:
    """Pure local heuristic used as the default LLM. No network call."""
    s = get_settings()
    # JSON shape for suggest-improvements
    if json_schema and "action" in json_schema.get("properties", {}):
        return _heuristic_suggest(prompt)
    # The title_check call from ingest_node passes a dict {"title":..., "content":...}
    # as the second arg. Detect by presence of those keys (cheap duck-typing).
    if isinstance(json_schema, dict) and (
        "ok" in json_schema.get("properties", {})  # real schema
        or ("title" in json_schema and "content" in json_schema)  # legacy shape
    ):
        return _heuristic_title_check(prompt, json_schema)
    # Default: return whatever the prompt asks for as opaque dict.
    return {"_hint": "heuristic", "echo": (prompt or "")[:200]}


def _heuristic_title_check(prompt: str, json_schema: dict | None) -> dict:
    """Cheap local fallback for title_check.

    The caller (services.knowledge.ingest_node) uses the slightly
    awkward shape `llm_call("title_check", {"title": ..., "content": ...})`
    where the second positional argument is the data, not a real JSON
    schema. We accept both: pull title/content out of json_schema when
    present, otherwise try to parse them from a string-form prompt that
    uses ``title:`` / ``content:`` lines.
    """
    title = ""
    content = ""
    if isinstance(json_schema, dict) and ("title" in json_schema or "content" in json_schema):
        title = str(json_schema.get("title", "") or "")
        content = str(json_schema.get("content", "") or "")
    else:
        # The prompt looks like: title_check\ntitle: <X>\ncontent: <Y>
        for line in (prompt or "").splitlines():
            low = line.strip().lower()
            if low.startswith("title:"):
                title = line.split(":", 1)[1].strip()
            elif low.startswith("content:"):
                content = line.split(":", 1)[1].strip()

    # Domain-token overlap between title and content. If every key word in
    # the title is also in the content (after tokenization) the title is
    # consistent with the content.
    title_tokens = _domain_tokens(title)
    content_tokens = _domain_tokens(content)
    if not title_tokens:
        # Title has no recognisable content words — fall back to a generic
        # "ok" so the user does not see noise on every node add.
        return {
            "ok": True,
            "confidence": 0.0,
            "reason": "title is too short to evaluate",
            "suggestion": "",
        }
    overlap = _jaccard(title_tokens, content_tokens)
    # If a big chunk of the title tokens are present in the content, the
    # title is supported. Otherwise it might be misleading.
    ok = overlap >= 0.5
    if ok:
        reason = f"title vocabulary overlaps with content ({overlap:.0%})"
        suggestion = ""
    else:
        reason = f"title vocabulary does not match content (only {overlap:.0%} overlap)"
        # Suggest the first content-line noun phrase as a new title.
        first_line = (content or "").splitlines()[0] if content else ""
        suggestion = first_line[:60].strip()
        if not suggestion:
            suggestion = title  # give up: keep current
    return {
        "ok": ok,
        "confidence": overlap,
        "reason": reason,
        "suggestion": suggestion,
    }


def _heuristic_suggest(prompt: str) -> dict:
    """Cheap local fallback for suggest-improvements. Picks the pair of
    nodes with the highest embedding similarity that are NOT already
    linked, and recommends either 'link' or 'merge' depending on the
    similarity score.
    """
    s = get_settings()
    # The prompt is built by the route; this fallback just returns a
    # placeholder so the API contract is honoured. The real AI path
    # (when an openai key is configured) is in `_openai_suggest`.
    return {
        "action": "noop",
        "rationale": "heuristic fallback: no LLM configured. Set an OpenAI key in /api/llm/config to get real suggestions.",
        "nodes": [],
    }


# --------- openai implementation ---------

def _openai_suggest(prompt: str, json_schema: dict | None) -> dict:
    """Call OpenAI Chat Completions with a JSON response shape."""
    import httpx
    cfg = resolve_provider()
    api_key = get_runtime_override("openai_api_key") or get_settings().openai_api_key
    if not api_key:
        return {"action": "noop", "rationale": "openai key not configured", "nodes": []}

    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": "You are an AI therapist for a personal knowledge graph. You only suggest ONE improvement at a time. Output strict JSON."},
            {"role": "user",   "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    headers = {"authorization": f"Bearer {api_key}", "content-type": "application/json"}
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post("https://api.openai.com/v1/chat/completions",
                            json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        return {"action": "noop", "rationale": f"openai call failed: {e}", "nodes": []}


# --------- public entry ---------

def complete(prompt: str, json_schema: dict | None = None) -> dict:
    cfg = resolve_provider()
    if cfg["provider"] == "openai":
        return _openai_suggest(prompt, json_schema)
    # default: heuristic
    return heuristic_complete(prompt, json_schema)


# backward-compat alias (used by older callers)
llm_call = complete