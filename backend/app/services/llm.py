"""LLM provider abstraction.

Default: `heuristic` — pure local Python, no network. Used for the demo + tests.
Optional: `openai` (set OPENAI_API_KEY) and `ollama` (local llama.cpp server).

All providers return a JSON dict with the same shape, so callers don't care.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import get_settings


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
    # preserve order, dedupe
    seen, res = set(), []
    for t in out:
        if t.lower() not in seen:
            seen.add(t.lower())
            res.append(t)
    return res[:12]


def _heuristic_call(prompt_kind: str, payload: dict) -> dict:
    """Pure-Python fallback that produces the same JSON shape as the real LLM."""
    if prompt_kind == "title_check":
        title = (payload.get("title") or "").strip()
        content = (payload.get("content") or "").strip()
        title_tokens = set(t.lower() for t in re.findall(r"[A-Za-z0-9]+", title))
        content_tokens = set(t.lower() for t in re.findall(r"[A-Za-z0-9]+", content))
        overlap = len(title_tokens & content_tokens) / max(1, len(title_tokens))
        # 标题里如果有大写缩写或多 token 都在内容里 → 置信度高
        if overlap >= 0.5:
            return {"ok": True, "confidence": round(overlap, 2), "suggestion": title,
                    "reason": "标题关键词在正文中有充分覆盖"}
        # 否则挑内容里出现最频繁的关键词做建议
        candidates = _domain_tokens(content)[:5]
        suggestion = candidates[0] if candidates else title
        return {
            "ok": False,
            "confidence": round(overlap, 2),
            "suggestion": suggestion,
            "reason": "标题与正文重合度较低，建议使用正文中更核心的概念",
        }

    if prompt_kind == "extract":
        title = payload.get("title", "")
        content = payload.get("content", "")
        kws = _domain_tokens(f"{title} {content}")
        # summary: 第一句或者前 200 字
        first = re.split(r"[。.!?！？\n]", content, maxsplit=1)[0].strip()
        summary = first if len(first) >= 20 else (content[:200] + ("…" if len(content) > 200 else ""))
        return {
            "keywords": kws,
            "summary": summary,
            "category_hint": _guess_category(kws, content),
        }

    if prompt_kind == "category":
        text = (payload.get("text") or "").lower()
        cats = payload.get("candidates") or []
        scores = {}
        for c in cats:
            score = 0
            for kw in c.get("keywords", []):
                if kw.lower() in text:
                    score += 1
            scores[c["name"]] = score
        best = max(scores, key=scores.get) if scores else (cats[0]["name"] if cats else "未分类")
        return {"category": best, "scores": scores}

    return {}


def _guess_category(keywords: list[str], content: str) -> str:
    text = " ".join(keywords + [content]).lower()
    rules = [
        ("AI人工智能", {"llm", "transformer", "attention", "embedding", "rag", "agent", "qwen", "deepseek", "llama", "gpt"}),
        ("大模型", {"grpo", "rlhf", "ppo", "dpo", "kto", "lora", "qlora", "adalora", "vllm", "sglang"}),
        ("编程开发", {"python", "fastapi", "react", "typescript", "postgres", "pgvector", "docker", "k8s"}),
        ("通信", {"3gpp", "5g", "nr", "lte", "ran", "core", "ofdm"}),
        ("投资财经", {"fed", "fomc", "etf", "bond", "yield", "macro", "valuation"}),
        ("学术研究", {"paper", "arxiv", "research", "experiment", "hypothesis"}),
        ("工作经验", {"team", "project", "review", "management", "sprint", "okr"}),
        ("生活健康", {"sleep", "exercise", "diet", "meditation", "health"}),
        ("兴趣爱好", {"music", "guitar", "piano", "photo", "cook", "travel"}),
        ("人文历史", {"history", "philosophy", "literature", "culture"}),
    ]
    scores = {cat: 0 for cat, _ in rules}
    for cat, kws in rules:
        for kw in kws:
            if kw in text:
                scores[cat] += 2
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "未分类"


# --------- public API ---------

def llm_call(prompt_kind: str, payload: dict, *, force_provider: str | None = None) -> dict:
    """Dispatch to the configured LLM provider.

    Always returns a dict. Falls back to heuristic on any failure.
    """
    settings = get_settings()
    provider = force_provider or settings.llm_provider

    if provider == "openai" and settings.openai_api_key:
        try:
            return _openai_call(settings, prompt_kind, payload)
        except Exception as exc:
            print(f"[llm] openai failed ({exc}); falling back to heuristic")

    if provider == "ollama":
        try:
            return _ollama_call(settings, prompt_kind, payload)
        except Exception as exc:
            print(f"[llm] ollama failed ({exc}); falling back to heuristic")

    return _heuristic_call(prompt_kind, payload)


# --------- OpenAI / Ollama implementations (best-effort, lazy) ---------

def _openai_call(settings, prompt_kind: str, payload: dict) -> dict:
    import httpx
    sys_prompt = (
        "You are an assistant that always returns STRICT JSON. "
        "No prose, no markdown fences, just a single JSON object."
    )
    user_prompt = f"Task: {prompt_kind}\nInput: {json.dumps(payload, ensure_ascii=False)}\nReturn JSON only."
    r = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
        json={
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        },
        timeout=60,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def _ollama_call(settings, prompt_kind: str, payload: dict) -> dict:
    import httpx
    sys_prompt = "Always respond with strict JSON only."
    user_prompt = f"Task: {prompt_kind}\nInput: {json.dumps(payload, ensure_ascii=False)}"
    r = httpx.post(
        f"{settings.ollama_base_url}/api/chat",
        json={
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "format": "json",
            "stream": False,
        },
        timeout=60,
    )
    r.raise_for_status()
    content = r.json()["message"]["content"]
    return json.loads(content)