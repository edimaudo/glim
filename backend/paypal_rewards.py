"""PayPal Sandbox payout adapter. This module deliberately cannot send live payouts."""
from __future__ import annotations
import base64
import os
import uuid
import httpx


class PayPalConfigurationError(RuntimeError):
    pass


async def create_sandbox_payout(recipient_email: str, amount_cad: str = "1.00") -> dict:
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
            batch_id = f"glim-{uuid.uuid4().hex}"
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
                        "sender_item_id": f"reward-{uuid.uuid4().hex[:12]}",
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
        message = "PayPal Sandbox rejected the payout request. Check Payouts permission, recipient sandbox account, and API credentials."
        raise RuntimeError(f"{message} (HTTP {code})") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError("PayPal Sandbox could not be reached. No successful payout response was received.") from exc
