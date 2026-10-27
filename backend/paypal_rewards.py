"""PayPal Sandbox payout adapter. This module deliberately cannot send live payouts."""
from __future__ import annotations
import os
import uuid
import hashlib
import httpx


class PayPalConfigurationError(RuntimeError):
    pass


async def create_sandbox_payout(recipient_email: str, amount_cad: str = "1.00", client_claim_id: str | None = None) -> dict:
    if os.getenv("PAYPAL_ENV", "sandbox").lower() != "sandbox":
        raise PayPalConfigurationError("Glim only permits PayPal Sandbox payouts in this prototype. Live payouts are disabled.")
    client_id = os.getenv("PAYPAL_CLIENT_ID", "").strip()
    client_secret = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise PayPalConfigurationError("PayPal Sandbox is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.")
    if not recipient_email or len(recipient_email) > 127 or "@" not in recipient_email:
        raise ValueError("Enter a valid PayPal Sandbox recipient email address.")

    base = "https://api-m.sandbox.paypal.com"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=8.0)) as client:
            token_response = await client.post(
                f"{base}/v1/oauth2/token",
                auth=(client_id, client_secret),
                headers={"Accept": "application/json", "Accept-Language": "en_US"},
                data={"grant_type": "client_credentials"},
            )
            token_response.raise_for_status()
            token = token_response.json().get("access_token")
            if not token:
                raise RuntimeError("PayPal did not return an access token. Confirm the app has Payouts access.")
            if client_claim_id:
                stable_hash = hashlib.sha256(client_claim_id.strip().encode("utf-8")).hexdigest()
                batch_id = f"glim-{stable_hash[:24]}"  # Stable across retries; prevents a new batch ID for the same browser claim.
                item_id = f"reward-{stable_hash[:16]}"
            else:
                batch_id = f"glim-{uuid.uuid4().hex[:24]}"
                item_id = f"reward-{uuid.uuid4().hex[:16]}"
            payout_response = await client.post(
                f"{base}/v1/payments/payouts",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
                json={
                    "sender_batch_header": {
                        "sender_batch_id": batch_id,
                        "email_subject": "Your Glim Sandbox milestone reward",
                        "email_message": "This is a Glim hackathon prototype Sandbox reward. No real money is being sent.",
                    },
                    "items": [{
                        "recipient_type": "EMAIL",
                        "amount": {"value": amount_cad, "currency": "CAD"},
                        "receiver": recipient_email,
                        "note": "Glim test reward; PayPal Sandbox only.",
                        "sender_item_id": item_id,
                        "recipient_wallet": "PAYPAL",
                    }],
                },
            )
            payout_response.raise_for_status()
            data = payout_response.json()
        header = data.get("batch_header", {})
        return {
            "provider": "paypal-sandbox",
            "payout_batch_id": header.get("payout_batch_id"),
            "batch_status": header.get("batch_status", "ACKNOWLEDGED"),
            "sender_batch_id": header.get("sender_batch_header", {}).get("sender_batch_id", batch_id),
            "amount": {"value": amount_cad, "currency": "CAD"},
            "environment": "sandbox",
            "notice": "Sandbox payout request submitted. Check the batch status in PayPal Developer Dashboard; this is not a real payment.",
        }
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        message = "PayPal Sandbox rejected the payout request. Check Payouts permission, recipient sandbox account, and API credentials. If this was a retry, check the Developer Dashboard for the same sender batch ID before trying again."
        raise RuntimeError(f"{message} (HTTP {code})") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("PayPal Sandbox could not be reached. No successful payout response was received.") from exc


async def get_sandbox_payout_status(payout_batch_id: str) -> dict:
    """Fetch the status of a prior Sandbox batch without exposing recipient details."""
    if os.getenv("PAYPAL_ENV", "sandbox").lower() != "sandbox":
        raise PayPalConfigurationError("Glim only permits PayPal Sandbox requests in this prototype. Live payout access is disabled.")
    client_id = os.getenv("PAYPAL_CLIENT_ID", "").strip()
    client_secret = os.getenv("PAYPAL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise PayPalConfigurationError("PayPal Sandbox is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.")
    batch_id = (payout_batch_id or "").strip()
    if not batch_id or len(batch_id) > 128 or not all(ch.isalnum() or ch == "-" for ch in batch_id):
        raise ValueError("Enter a valid PayPal Sandbox payout batch ID.")
    base = "https://api-m.sandbox.paypal.com"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=8.0)) as client:
            token_response = await client.post(
                f"{base}/v1/oauth2/token",
                auth=(client_id, client_secret),
                headers={"Accept": "application/json", "Accept-Language": "en_US"},
                data={"grant_type": "client_credentials"},
            )
            token_response.raise_for_status()
            token = token_response.json().get("access_token")
            if not token:
                raise RuntimeError("PayPal did not return an access token. Confirm Sandbox API credentials.")
            response = await client.get(
                f"{base}/v1/payments/payouts/{batch_id}",
                params={"page": 1, "page_size": 100, "total_required": "true"},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
        items = data.get("items", []) or []
        counts: dict[str, int] = {}
        for item in items:
            item_data = item.get("payout_item", {}) if isinstance(item, dict) else {}
            status = str(item_data.get("transaction_status") or item.get("transaction_status") or "UNKNOWN")
            counts[status] = counts.get(status, 0) + 1
        return {
            "provider": "paypal-sandbox",
            "payout_batch_id": data.get("batch_header", {}).get("payout_batch_id", batch_id),
            "batch_status": data.get("batch_header", {}).get("batch_status", "UNKNOWN"),
            "items_in_response": len(items),
            "item_status_counts": counts,
            "time_completed": data.get("batch_header", {}).get("time_completed"),
            "environment": "sandbox",
            "notice": "Status retrieved from PayPal Sandbox. A batch submission or processing status is not a real-money payment.",
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise ValueError("PayPal could not find this Sandbox payout batch. Check the batch ID and environment.") from exc
        raise RuntimeError(f"PayPal Sandbox could not retrieve the batch status (HTTP {exc.response.status_code}).") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("PayPal Sandbox could not be reached to refresh the payout status.") from exc
