"""Pydantic models para o G4 Offers.

Todos os contratos de dados: requests, responses, regras, scores.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# =====================================================================
# ENUMS
# =====================================================================


class RiskGrade(str, Enum):
    A_PLUS = "A+"
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class OfferType(str, Enum):
    INSTALLMENT = "parcelado"
    CASH = "avista"
    PIX = "pix"
    STRUCTURED = "estruturado"  # Pagamento estruturado: início diferido + caução + promissória


class OfferStatus(str, Enum):
    PENDING = "pending"
    GENERATED = "generated"
    PRESENTED = "presented"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


class ExceptionStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class ApproverRole(str, Enum):
    MANAGER = "manager"
    DIRECTOR = "director"
    VP = "vp"


# =====================================================================
# SCORE COMPONENTS
# =====================================================================


class ScoreComponent(BaseModel):
    score: float = Field(..., ge=0, le=1000)
    weight: float = Field(..., ge=0, le=1)
    contribution: float = Field(..., ge=0)
    source: str = ""
    cached: bool = False
    cache_date: Optional[datetime] = None


class ScoreFactor(BaseModel):
    feature: str
    value: float | str
    impact: str  # "+45" or "-12"
    direction: str  # "reduz_risco" or "aumenta_risco"


class RiskScoreResult(BaseModel):
    deal_id: str
    g4_risk_score: int = Field(..., ge=0, le=1000)
    grade: RiskGrade
    components: dict[str, ScoreComponent]
    credit_limit: float
    credit_available: float
    top_factors: list[ScoreFactor] = []
    scored_at: datetime


# =====================================================================
# OFFER MODELS
# =====================================================================


class PaymentOption(BaseModel):
    id: str
    type: OfferType
    label: str
    recommended: bool = False
    installments: int = Field(..., ge=1)
    down_payment_pct: float = Field(..., ge=0, le=100)
    down_payment_value: float = Field(..., ge=0)
    interest_monthly_pct: float = Field(..., ge=0)
    installment_value: float = Field(..., ge=0)
    total_value: float = Field(..., ge=0)
    discount_pct: float = Field(0, ge=0, le=100)
    requires_approval: bool = False
    requires_promissory_note: bool = False


class SmartExitSuggestion(BaseModel):
    """Sugestão inteligente quando deal excede limite da faixa."""
    type: str  # "split_contract", "min_down_payment", "structured_payment"
    label: str
    description: str
    params: dict = {}  # e.g. {"contracts": 2, "amount_each": 50000}


class OfferRestrictions(BaseModel):
    max_credit_limit: float
    available_credit: float
    approval_required_above: Optional[float] = None
    promissory_required_above: Optional[float] = None
    smart_exits: list[SmartExitSuggestion] = []  # Saídas inteligentes quando excede limite


class OfferMenu(BaseModel):
    deal_id: str
    grade: RiskGrade
    offers: list[PaymentOption]
    restrictions: OfferRestrictions
    valid_until: datetime
    generated_at: datetime


# =====================================================================
# RULE MODELS
# =====================================================================


class PaymentOptionRule(BaseModel):
    type: OfferType
    label_template: str  # e.g. "{parcelas}x sem juros"
    installments_max: int = Field(1, ge=1, le=48)
    down_payment_pct: float = Field(0, ge=0, le=100)
    interest_monthly_pct: float = Field(0, ge=0)
    discount_cash_pct: float = Field(0, ge=0, le=100)
    recommended: bool = False


class OfferRuleRestrictions(BaseModel):
    requires_contract: bool = True
    requires_promissory_note: bool = False
    approval_manager_above: Optional[float] = None  # None = never
    approval_director_above: Optional[float] = None
    credit_limit_max: float = 500000


class OfferRule(BaseModel):
    id: str = ""
    name: str
    grades: list[RiskGrade]
    bus: list[str] = ["*"]  # ["*"] = all BUs
    amount_min: float = 0
    amount_max: float = 999999999
    options: list[PaymentOptionRule]
    restrictions: OfferRuleRestrictions = OfferRuleRestrictions()
    version: int = 1
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: str = ""


# =====================================================================
# EXCEPTION MODELS
# =====================================================================


class ExceptionRequest(BaseModel):
    deal_id: str
    seller_email: str
    desired_conditions: str
    justification: str
    deal_amount: float


class ExceptionRecord(BaseModel):
    id: str
    deal_id: str
    seller_email: str
    desired_conditions: str
    justification: str
    deal_amount: float
    current_grade: RiskGrade
    approver_role: ApproverRole
    approver_email: Optional[str] = None
    status: ExceptionStatus = ExceptionStatus.PENDING
    decision_note: str = ""
    created_at: datetime
    decided_at: Optional[datetime] = None


# =====================================================================
# API REQUEST / RESPONSE MODELS
# =====================================================================


class ScoreRequest(BaseModel):
    deal_id: str
    company_cnpj: Optional[str] = None
    deal_amount: float = Field(..., gt=0)
    bu: str = "Scale"
    pipeline: str = ""
    force_bureau_refresh: bool = False
    # Optional HubSpot data passthrough (if not fetching live)
    hubspot_data: Optional[dict] = None


class OfferGenerateRequest(BaseModel):
    deal_id: str
    deal_amount: float = Field(..., gt=0)
    bu: str = "Scale"
    score: Optional[int] = None  # If already scored


class OfferSelectRequest(BaseModel):
    offer_id: str
    seller_email: str


class OfferAcceptRequest(BaseModel):
    offer_id: str
    seller_email: str
    client_confirmation: bool = True


# =====================================================================
# HUBSPOT MODELS
# =====================================================================


class HubSpotDealUpdate(BaseModel):
    """Properties to write back to HubSpot deal."""
    g4_risk_score: Optional[int] = None
    g4_risk_grade: Optional[str] = None
    g4_risk_score_date: Optional[str] = None
    g4_offer_status: Optional[str] = None
    g4_offer_selected: Optional[str] = None
    g4_offer_parcelas: Optional[int] = None
    g4_offer_entrada_pct: Optional[float] = None
    g4_offer_juros_am: Optional[float] = None
    g4_offer_desconto_pct: Optional[float] = None
    g4_offer_valor_parcela: Optional[float] = None
    g4_offer_valor_total: Optional[float] = None
    g4_offer_aprovador: Optional[str] = None
    g4_offer_menu_json: Optional[str] = None
    g4_credit_limit: Optional[float] = None
    g4_credit_limit_available: Optional[float] = None


class HubSpotWebhookEvent(BaseModel):
    """Incoming webhook event from HubSpot."""
    event_id: int = 0
    subscription_id: int = 0
    portal_id: int = 0
    app_id: int = 0
    occurred_at: int = 0  # epoch ms
    event_type: str = ""  # e.g. "deal.propertyChange"
    property_name: str = ""
    property_value: str = ""
    object_id: int = 0
    change_source: str = ""


# =====================================================================
# DASHBOARD MODELS
# =====================================================================


class DashboardSummary(BaseModel):
    total_offers_generated: int
    total_deals_with_offer: int
    average_risk_score: int
    acceptance_rate: float  # 0-1
    total_amount_offered: float
    period: str  # e.g. "2026-03"


class ConversionByGrade(BaseModel):
    grade: RiskGrade
    deals: int
    accepted: int
    conversion_rate: float
    average_amount: float


class ExceptionSummary(BaseModel):
    total_requested: int
    total_approved: int
    total_rejected: int
    approval_rate: float
    top_reason: str
