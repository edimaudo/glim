"""Optional Qloo-powered book ideas. Recommendations are entertainment ideas, not products to buy."""
from __future__ import annotations
import os
import httpx

STARTER_IDEAS = [
    {"name": "Borrow a money book from the library", "description": "A free, low-cost way to explore personal finance without adding another purchase."},
    {"name": "Choose a no-spend evening", "description": "Pick a movie, playlist, walk, or game you already have access to."},
    {"name": "Celebrate with a small experience", "description": "Consider a free community event or a favourite outdoor spot."},
]


def _extract_books(data: dict) -> list[dict]:
    results = data.get("results", {}) if isinstance(data, dict) else {}
    entities = results.get("entities", []) if isinstance(results, dict) else []
    parsed = []
    for entity in entities[:6]:
        name = entity.get("name") or entity.get("properties", {}).get("name")
        if not name:
            continue
        parsed.append({
            "name": str(name),
            "description": "A Qloo-discovered book suggestion based on the interest signals provided. Check library availability before buying.",
        })
    return parsed


async def get_reward_ideas(tags: list[str] | None = None) -> dict:
    api_key = os.getenv("QLOO_API_KEY", "").strip()
    if not api_key:
        return {"provider": "starter-ideas", "configured": False, "ideas": STARTER_IDEAS, "notice": "Choose rewards that fit your interests without adding pressure to your budget. Check for free or library options before spending."}
    tags = [tag.strip() for tag in (tags or []) if tag.strip()][:8]
    if not tags:
        return {"provider": "qloo", "configured": True, "ideas": [], "notice": "Choose one or more supported Qloo interest-tag IDs to request personalized book ideas."}
    base = os.getenv("QLOO_API_BASE_URL", "https://api.qloo.com").rstrip("/")
    params = {"filter.type": "urn:entity:book", "signal.interests.tags": ",".join(tags), "take": "6"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=6.0)) as client:
            response = await client.get(f"{base}/v2/insights", params=params, headers={"X-Api-Key": api_key, "accept": "application/json"})
            response.raise_for_status()
            data = response.json()
        ideas = _extract_books(data)
        return {"provider": "qloo", "configured": True, "ideas": ideas, "notice": "Interest-based book suggestions. Check availability at your library first; Glim does not recommend spending money to earn rewards."}
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"Qloo request failed with HTTP {exc.response.status_code}. Check the API key and supported interest tags.") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("Qloo could not be reached. Try again later.") from exc
