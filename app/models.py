from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class Profile(BaseModel):
    name: str = "Riley"
    persona: Literal["riley", "sam"] = "riley"
    monthly_income: float = Field(gt=0)
    income_range: str
    savings_pct: float = Field(default=5.0, ge=0, le=50)
    approval_mode: Literal["each", "weekly_cap", "standing_rule"] = "each"
    weekly_cap: float = Field(default=60.0, ge=0)
    floor_balance: float = Field(default=1000.0, ge=0)
    quiet_start: str = "22:00"
    quiet_end: str = "08:00"
    notification_cap: int = Field(default=3, ge=0, le=10)
    notification_channel: Literal["in_app", "web_push"] = "in_app"


class DebtCreate(BaseModel):
    name: str = Field(min_length=1)
    type: Literal["credit_card", "loan"] = "credit_card"
    balance: float = Field(gt=0)
    apr: float = Field(ge=0)
    minimum: float = Field(gt=0)
    due_day: int = Field(default=15, ge=1, le=31)


class PlanRequest(BaseModel):
    strategy: Literal["avalanche", "snowball", "hybrid"] = "avalanche"
    stash_pct: float = Field(default=65.0, ge=0, le=100)


class WhatIfRequest(BaseModel):
    text: str = Field(min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)


class ApprovalRequest(BaseModel):
    approve: bool = True


class NudgeResponseRequest(BaseModel):
    response: Literal["acted", "opened", "snoozed", "dismissed", "muted"]


class AuthRequest(BaseModel):
    email: str = Field(min_length=3)


class RedirectRequest(BaseModel):
    destination: Literal["stash"] | int


class SquadCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class SquadJoinRequest(BaseModel):
    invite_code: str = Field(min_length=4, max_length=20)


class CheerRequest(BaseModel):
    member_id: int
    cheer: Literal["Nice streak!", "Keep going!", "Tiny win, big habit.", "Your consistency is showing."]


class LessonCompleteRequest(BaseModel):
    lesson_id: int
    answer: str = ""
