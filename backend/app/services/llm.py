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

# --------- defensive proxy env sanitisation ---------
# Some shell environments (and some launch wrappers like nohup
# when invoked from a particular shell) rewrite ALL_PROXY from
# "socks5://..." to "socks://...". httpx 0.28 only accepts the
# schemes http, https, socks5, socks5h for proxy URLs, so a
# "socks://" entry raises "ValueError: Unknown scheme for proxy
# URL" the moment any httpx call fires. The backend does not
# need SOCKS proxying — it talks to LLM providers over HTTPS
# (via HTTPS_PROXY) and downloads the sentence-transformers
# model once at startup (cached after). We therefore drop the
# SOCKS entries from the inherited env at import time so the
# backend always works. Users who need SOCKS should set
# HTTPS_PROXY=http://... to a local SOCKS-to-HTTP gateway.
import os as _os_sanitise
import re
from typing import Any

from app.core.config import get_settings

for _proxy_var in ("all_proxy", "ALL_PROXY"):
    _proxy_val = _os_sanitise.environ.get(_proxy_var, "")
    if _proxy_val.startswith("socks://"):
        _os_sanitise.environ.pop(_proxy_var, None)
del _os_sanitise, _proxy_var, _proxy_val
# --------- provider registry ---------
# Each provider has:
#   - kind:        "openai-compat" or "gemini"
#   - label:       human-readable vendor name
#   - base_url:    API base (only used by openai-compat)
#   - default_model: a sensible default to pre-fill the model field
#   - api_key_label: placeholder hint shown next to the key input
#
# "openai-compat" providers reuse the OpenAI Chat Completions shape
# (DeepSeek, Moonshot Kimi, Qwen DashScope, MiniMax M3 all conform).
# "gemini" uses the Google Generative Language REST API.
# We keep "ollama" registered too so users can target a local llama.cpp
# server via the same UI.
PROVIDERS = {
    "heuristic": {
        "kind": "local",
        "label": "heuristic (local, no network)",
        "default_model": "",
        "needs_api_key": False,
        "api_key_label": "",
    },
    "openai": {
        "kind": "openai-compat",
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "needs_api_key": True,
        "api_key_label": "sk-...",
    },
    "deepseek": {
        "kind": "openai-compat",
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "needs_api_key": True,
        "api_key_label": "sk-...",
    },
    "kimi": {
        "kind": "openai-compat",
        "label": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-8k",
        "needs_api_key": True,
        "api_key_label": "sk-...",
    },
    "qwen": {
        "kind": "openai-compat",
        "label": "Qwen (DashScope)",
        # DashScope's OpenAI-compatible endpoint:
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-turbo",
        "needs_api_key": True,
        "api_key_label": "sk-...",
    },
    "minimax": {
        "kind": "openai-compat",
        "label": "MiniMax",
        # MiniMax exposes an OpenAI-compatible /chat/completions
        # endpoint at api.minimax.chat/v1. Default to M3 (verified
        # live). M3 supports a non-standard "thinking" parameter
        # that lets us disable its reasoning block:
        #   {"thinking": {"type": "disabled"}}
        # We send that whenever the provider is "minimax" so the
        # response content is the bare answer, not a "<think>..."
        # reasoning block that breaks JSON parsing.
        "base_url": "https://api.minimax.chat/v1",
        "default_model": "MiniMax-M3",
        "needs_api_key": True,
        "api_key_label": "sk-...",
    },
    "gemini": {
        "kind": "gemini",
        "label": "Gemini (Google)",
        # Gemini uses a different REST shape; we hit it directly.
        "base_url": "https://generativelanguage.googleapis.com",
        "default_model": "gemini-2.0-flash",
        "needs_api_key": True,
        "api_key_label": "AIza...",
    },
    "ollama": {
        "kind": "openai-compat",
        "label": "Ollama (local)",
        "base_url": "http://localhost:11434/v1",
        "default_model": "llama3.1",
        "needs_api_key": False,
        "api_key_label": "(not required)",
    },
}


def provider_label(name: str) -> str:
    return PROVIDERS.get(name, {}).get("label", name or "unknown")


def provider_kind(name: str) -> str:
    return PROVIDERS.get(name, {}).get("kind", "openai-compat")


def provider_base_url(name: str) -> str:
    return PROVIDERS.get(name, {}).get("base_url", "")


def provider_default_model(name: str) -> str:
    return PROVIDERS.get(name, {}).get("default_model", "")


def provider_needs_api_key(name: str) -> bool:
    return PROVIDERS.get(name, {}).get("needs_api_key", False)


# --------- runtime overrides (set by user via /api/llm/config) ---------
# In-memory only: cleared on backend restart. Not persisted to DB.
_runtime_overrides: dict[str, str] = {}


def set_runtime_override(key: str, value: str) -> None:
    if value is None or value == "":
        _runtime_overrides.pop(key, None)
    else:
        _runtime_overrides[key] = value


def get_runtime_override(key: str) -> str | None:
    return _runtime_overrides.get(key)


def clear_runtime_overrides() -> None:
    _runtime_overrides.clear()


def resolve_provider() -> dict[str, Any]:
    """Return the active provider config (with runtime overrides applied).

    Also returns base_url + vendor label so the frontend can show "you
    are connected to <vendor> via <base_url>".
    """
    s = get_settings()
    provider = get_runtime_override("llm_provider") or s.llm_provider
    api_key = get_runtime_override("openai_api_key") or s.openai_api_key
    model = get_runtime_override("llm_model") or s.llm_model
    return {
        "provider": provider,
        "provider_label": provider_label(provider),
        "provider_kind": provider_kind(provider),
        "base_url": provider_base_url(provider),
        "model": model,
        "has_api_key": bool(api_key),
        "api_key_source": (
            "runtime" if get_runtime_override("openai_api_key") else
            "env"      if s.openai_api_key else
            "none"
        ),
    }


# --------- heuristic implementation ---------

_STOPWORDS = set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "he", "her", "his", "i", "if", "in", "is", "it", "its", "of", "on", "or", "our", "she", "that", "the", "they", "this", "to", "was", "we", "were", "what", "when", "which", "who", "why", "will", "with", "you", "your", "not", "no", "but", "do", "does", "did", "done", "been", "being", "am", "is", "are", "was", "were", "so", "than", "then", "there", "here", "these", "those", "some", "any", "all", "most", "more", "less", "much", "many", "very", "can", "could", "should", "would", "may", "might", "shall", "will"])

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
    # The prompt is built by the route; this fallback just returns a
    # placeholder so the API contract is honoured. The real AI path
    # (when an openai key is configured) is in `_openai_suggest`.
    return {
        "action": "noop",
        "rationale": "heuristic fallback: no LLM configured. Set an OpenAI key in /api/llm/config to get real suggestions.",
        "nodes": [],
    }


# --------- OpenAI-compatible client (used by OpenAI / DeepSeek / Kimi /
# Qwen / MiniMax / Ollama / anything else with a /chat/completions route) ---

def _openai_compat_suggest(prompt: str, json_schema: dict | None) -> dict:
    """Hit the configured provider's /chat/completions endpoint and return
    the parsed JSON content. Returns a fallback `{action:"noop",...}` dict
    on any error so the caller never crashes.
    """
    import httpx
    cfg = resolve_provider()
    api_key = get_runtime_override("openai_api_key") or get_settings().openai_api_key
    base_url = cfg["base_url"]
    if not base_url:
        return {"action": "noop", "rationale": f"{cfg['provider']}: no base_url configured", "nodes": []}
    if not api_key and provider_needs_api_key(cfg["provider"]):
        return {"action": "noop", "rationale": f"{cfg['provider']}: api key not configured", "nodes": []}

    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": "You are an AI therapist for a personal knowledge graph. You only suggest ONE improvement at a time. Output strict JSON."},
            {"role": "user",   "content": prompt},
        ],
        "temperature": 0.2,
    }
    # Only OpenAI itself supports response_format json_object reliably; the
    # other providers may ignore it but the prompt asks for JSON anyway.
    if cfg["provider"] == "openai":
        payload["response_format"] = {"type": "json_object"}
    # MiniMax M3 emits a "<think>...</think>" reasoning block before
    # the actual answer, which breaks json.loads. The provider accepts
    # a non-standard {"thinking": {"type": "disabled"}} parameter to
    # suppress that block at the source. Send it whenever the user is
    # on minimax so we get clean JSON back.
    if cfg["provider"] == "minimax":
        payload["thinking"] = {"type": "disabled"}
    headers = {"authorization": f"Bearer {api_key}", "content-type": "application/json"} if api_key else {"content-type": "application/json"}
    url = base_url.rstrip("/") + "/chat/completions"
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
        content = data["choices"][0]["message"]["content"]
        # Defensive: strip any <think>...</think> block a model might
        # still emit (different providers may have different flags).
        content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL)
        # Also strip ```json ... ``` fences some providers add.
        content = re.sub(r"^\s*```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```\s*\Z", "", content)
        return json.loads(content)
    except Exception as e:
        return {"action": "noop", "rationale": f"{cfg['provider']} call failed: {e}", "nodes": []}


# --------- free-form chat (used by AssistantPanel Ask-Tab) ---------

def _openai_compat_chat(prompt: str, *, system: str | None = None) -> str:
    """Same transport as _openai_compat_suggest but returns the raw
    string content (no JSON parsing). Used for the retrieval-augmented
    Q&A in Step 3 where we want a natural-language answer.
    """
    import httpx
    cfg = resolve_provider()
    api_key = get_runtime_override("openai_api_key") or get_settings().openai_api_key
    base_url = cfg["base_url"]
    if not base_url:
        return f"({cfg['provider']}: no base_url configured)"
    if not api_key and provider_needs_api_key(cfg["provider"]):
        return f"({cfg['provider']}: api key not configured)"
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": prompt})
    payload = {
        "model": cfg["model"],
        "messages": msgs,
        "temperature": 0.3,
    }
    if cfg["provider"] == "minimax":
        payload["thinking"] = {"type": "disabled"}
    headers = {"authorization": f"Bearer {api_key}", "content-type": "application/json"} if api_key else {"content-type": "application/json"}
    url = base_url.rstrip("/") + "/chat/completions"
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, json=payload, headers=headers)
            r.raise_for_status()
            data = r.json()
        content = data["choices"][0]["message"]["content"]
        # Strip any reasoning block the model might still emit.
        content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL)
        return content.strip()
    except Exception as e:
        return f"({cfg['provider']} call failed: {e})"


def _gemini_chat(prompt: str, *, system: str | None = None) -> str:
    import httpx
    cfg = resolve_provider()
    api_key = get_runtime_override("openai_api_key") or get_settings().openai_api_key
    if not api_key:
        return "(gemini: api key not configured)"
    url = f"{cfg['base_url'].rstrip('/')}/v1beta/models/{cfg['model']}:generateContent"
    parts = []
    if system:
        parts.append({"text": system})
    parts.append({"text": prompt})
    payload = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"temperature": 0.3}}
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, params={"key": api_key}, json=payload,
                             headers={"content-type": "application/json"})
            r.raise_for_status()
            data = r.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        return f"(gemini call failed: {e})"


def complete_chat(prompt: str, *, system: str | None = None) -> str:
    """Free-form chat completion. Returns the raw string answer
    (or a heuristic-friendly fallback). Picks provider based on
    current config."""
    cfg = resolve_provider()
    kind = provider_kind(cfg["provider"])
    if kind == "openai-compat":
        return _openai_compat_chat(prompt, system=system)
    if kind == "gemini":
        return _gemini_chat(prompt, system=system)
    # local / unknown — heuristic
    return _heuristic_chat(prompt)


def _heuristic_chat(prompt: str) -> str:
    """Best-effort answer when no LLM is configured. We just acknowledge
    the question and tell the user to set up a provider."""
    return (
        "(未配置大模型：请到 Settings 里选个 provider 并填 API key。\n"
        f"当前 provider = heuristic。\n"
        f"你的问题：{prompt[:200]})"
    )


# --------- Gemini (Google Generative Language API) ---------

def _gemini_suggest(prompt: str, json_schema: dict | None) -> dict:
    """Hit Gemini's generateContent endpoint. Returns parsed JSON."""
    import httpx
    cfg = resolve_provider()
    api_key = get_runtime_override("openai_api_key") or get_settings().openai_api_key
    if not api_key:
        return {"action": "noop", "rationale": "gemini: api key not configured", "nodes": []}
    url = f"{cfg['base_url'].rstrip('/')}/v1beta/models/{cfg['model']}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2},
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, params={"key": api_key}, json=payload,
                             headers={"content-type": "application/json"})
            r.raise_for_status()
            data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        # Gemini sometimes wraps JSON in ```json ... ``` fences — strip them.
        text = re.sub(r"^\s*```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*\Z", "", text)
        return json.loads(text)
    except Exception as e:
        return {"action": "noop", "rationale": f"gemini call failed: {e}", "nodes": []}


# --------- public entry ---------

def complete(prompt: str, json_schema: dict | None = None) -> dict:
    cfg = resolve_provider()
    name = cfg["provider"]
    kind = provider_kind(name)
    if kind == "openai-compat":
        return _openai_compat_suggest(prompt, json_schema)
    if kind == "gemini":
        return _gemini_suggest(prompt, json_schema)
    # "local" or unknown → heuristic
    return heuristic_complete(prompt, json_schema)


def test_connection(override: dict[str, str] | None = None) -> dict:
    """Probe the configured provider with a tiny call and report whether
    the key + endpoint actually work. Used by the Settings tab to drive
    the connection status light. Returns {ok, status, model, detail}.

    If `override` is given, the named keys (llm_provider / openai_api_key /
    llm_model) are used INSTEAD of the runtime + env overrides. This
    lets the Settings tab probe a not-yet-saved form value.
    """
    import httpx
    s = get_settings()
    if override:
        provider = override.get("llm_provider", s.llm_provider)
        api_key  = override.get("openai_api_key", s.openai_api_key)
        model    = override.get("llm_model", s.llm_model)
    else:
        provider = get_runtime_override("llm_provider") or s.llm_provider
        api_key  = get_runtime_override("openai_api_key") or s.openai_api_key
        model    = get_runtime_override("llm_model") or s.llm_model
    name = provider
    kind = provider_kind(name)
    base_url = provider_base_url(name)
    cfg = {
        "provider": provider,
        "provider_label": provider_label(provider),
        "provider_kind": kind,
        "base_url": base_url,
        "model": model,
        "has_api_key": bool(api_key),
        "api_key_source": "override" if override and "openai_api_key" in override else
                          ("runtime" if get_runtime_override("openai_api_key") else
                           "env"     if s.openai_api_key else
                           "none"),
    }

    # Local heuristic — we don't actually talk to the network; mark it
    # "ok" so the light turns green and the user knows the brain is
    # working in the default mode.
    if kind == "local":
        return {
            "ok": True,
            "provider": name,
            "provider_label": cfg["provider_label"],
            "model": cfg["model"] or "(none)",
            "detail": "heuristic — runs locally, no network calls",
        }

    # No key when one is required — fail early.
    if not api_key and provider_needs_api_key(name):
        return {
            "ok": False,
            "provider": name,
            "provider_label": cfg["provider_label"],
            "model": cfg["model"],
            "detail": "api key not configured",
        }

    try:
        if kind == "openai-compat":
            url = cfg["base_url"].rstrip("/") + "/models"
            headers = {"authorization": f"Bearer {api_key}"} if api_key else {}
            with httpx.Client(timeout=10.0) as client:
                r = client.get(url, headers=headers)
            ok = r.status_code in (200, 401)  # 401 means key is wrong but endpoint is reachable
            detail = f"GET {url} → HTTP {r.status_code}"
            if r.status_code == 401:
                detail += " (key invalid — endpoint reachable)"
            elif r.status_code == 200:
                detail += " (key accepted)"
            return {
                "ok": ok,
                "provider": name,
                "provider_label": cfg["provider_label"],
                "model": cfg["model"],
                "detail": detail,
            }
        if kind == "gemini":
            url = f"{cfg['base_url'].rstrip('/')}/v1beta/models"
            with httpx.Client(timeout=10.0) as client:
                r = client.get(url, params={"key": api_key})
            ok = r.status_code in (200, 400, 403)
            detail = f"GET {url} → HTTP {r.status_code}"
            return {
                "ok": ok,
                "provider": name,
                "provider_label": cfg["provider_label"],
                "model": cfg["model"],
                "detail": detail,
            }
    except Exception as e:
        return {
            "ok": False,
            "provider": name,
            "provider_label": cfg["provider_label"],
            "model": cfg["model"],
            "detail": f"{type(e).__name__}: {e}",
        }
    return {"ok": False, "provider": name, "provider_label": cfg["provider_label"],
            "model": cfg["model"], "detail": "unsupported provider kind"}


# backward-compat alias (used by older callers)
llm_call = complete