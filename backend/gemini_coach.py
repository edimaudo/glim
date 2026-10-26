"""Gemini Interactions API adapter. API key is only read by the backend."""
from __future__ import annotations
import os
import httpx
from .financial_safety import build_coach_input, local_coach_fallback

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")


async def get_coach_response(question: str, context: dict | None = None, tone: str = "balanced", mode: str = "coach") -> dict:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return {
            "reply": local_coach_fallback(question, context),
            "provider": "demo-fallback",
            "model": None,
            "configured": False,
            "notice": "Gemini is not configured. This is a local demo response; add GEMINI_API_KEY to enable live Gemini coaching.",
        }

    prompt = build_coach_input(question, context, tone, mode)
    url = os.getenv("GEMINI_API_URL", "https://generativelanguage.googleapis.com/v1beta/interactions")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(35.0, connect=8.0)) as client:
            response = await client.post(
                url,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json={"model": GEMINI_MODEL, "input": prompt},
            )
            response.raise_for_status()
            data = response.json()
        text = data.get("output_text")
        if not text:
            # Some interaction responses expose text in output content blocks.
            parts = []
            for item in data.get("output", []) or []:
                for content in item.get("content", []) or []:
                    if content.get("type") == "text" and content.get("text"):
                        parts.append(content["text"])
            text = "\n".join(parts).strip()
        if not text:
            raise ValueError("Gemini returned no text response")
        return {"reply": text, "provider": "gemini", "model": GEMINI_MODEL, "configured": True, "notice": None}
    except httpx.HTTPStatusError as exc:
        # Avoid returning upstream response bodies that may contain provider details.
        raise RuntimeError(f"Gemini request failed with HTTP {exc.response.status_code}. Check the API key, model, and quota.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError("Gemini could not respond right now. Check the connection and service configuration, then try again.") from exc
