"""Rules Store — CRUD de regras de oferta com versionamento.

Storage: Firestore (collection "offer_rules").
Cada regra tem versionamento automático — editar cria nova versão.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from models import OfferRule, RiskGrade

# =====================================================================
# IN-MEMORY STORE (para development / testes)
# Firestore integration é lazy — usa in-memory se Firestore não disponível
# =====================================================================

_memory_store: dict[str, list[OfferRule]] = {}  # id → [versions]
_firestore_client = None


def _get_firestore():
    global _firestore_client
    if _firestore_client is not None:
        return _firestore_client

    try:
        from google.cloud import firestore
        project = os.getenv("GCP_PROJECT", "g4-cobranca-pipeline")
        _firestore_client = firestore.Client(project=project)
        return _firestore_client
    except Exception as e:
        print(f"[RulesStore] Firestore unavailable, using in-memory: {e}")
        return None


COLLECTION = os.getenv("FIRESTORE_RULES_COLLECTION", "offer_rules")


# =====================================================================
# CRUD
# =====================================================================


async def list_rules(active_only: bool = True) -> list[OfferRule]:
    """Lista todas as regras (versão mais recente de cada)."""
    db = _get_firestore()

    if db:
        docs = db.collection(COLLECTION).stream()
        rules = []
        for doc in docs:
            data = doc.to_dict()
            rule = OfferRule(**data)
            rule.id = doc.id
            if active_only and not rule.is_active:
                continue
            rules.append(rule)
        return rules

    # In-memory fallback
    rules = []
    for rule_id, versions in _memory_store.items():
        if versions:
            latest = versions[-1]
            if active_only and not latest.is_active:
                continue
            rules.append(latest)
    return rules


async def get_rule(rule_id: str) -> Optional[OfferRule]:
    """Busca uma regra pelo ID."""
    db = _get_firestore()

    if db:
        doc = db.collection(COLLECTION).document(rule_id).get()
        if doc.exists:
            data = doc.to_dict()
            rule = OfferRule(**data)
            rule.id = doc.id
            return rule
        return None

    # In-memory
    versions = _memory_store.get(rule_id, [])
    return versions[-1] if versions else None


async def create_rule(rule: OfferRule, created_by: str = "") -> OfferRule:
    """Cria nova regra."""
    rule.id = f"rule_{uuid.uuid4().hex[:12]}"
    rule.version = 1
    rule.created_at = datetime.now(timezone.utc)
    rule.updated_at = rule.created_at
    rule.created_by = created_by

    db = _get_firestore()

    if db:
        db.collection(COLLECTION).document(rule.id).set(
            rule.model_dump(mode="json")
        )
    else:
        _memory_store[rule.id] = [rule]

    return rule


async def update_rule(rule_id: str, updates: dict, updated_by: str = "") -> Optional[OfferRule]:
    """Atualiza regra, criando nova versão."""
    existing = await get_rule(rule_id)
    if not existing:
        return None

    # Criar nova versão
    updated = existing.model_copy(update=updates)
    updated.version = existing.version + 1
    updated.updated_at = datetime.now(timezone.utc)

    db = _get_firestore()

    if db:
        # Salvar versão anterior no histórico
        history_ref = (
            db.collection(COLLECTION)
            .document(rule_id)
            .collection("history")
            .document(f"v{existing.version}")
        )
        history_ref.set(existing.model_dump(mode="json"))

        # Atualizar documento principal
        db.collection(COLLECTION).document(rule_id).set(
            updated.model_dump(mode="json")
        )
    else:
        if rule_id not in _memory_store:
            _memory_store[rule_id] = []
        _memory_store[rule_id].append(updated)

    return updated


async def get_rule_history(rule_id: str) -> list[OfferRule]:
    """Retorna histórico de versões de uma regra."""
    db = _get_firestore()

    if db:
        history_docs = (
            db.collection(COLLECTION)
            .document(rule_id)
            .collection("history")
            .order_by("version")
            .stream()
        )
        versions = []
        for doc in history_docs:
            data = doc.to_dict()
            versions.append(OfferRule(**data))

        # Adicionar versão atual
        current = await get_rule(rule_id)
        if current:
            versions.append(current)
        return versions

    # In-memory
    return _memory_store.get(rule_id, [])


async def rollback_rule(rule_id: str, to_version: int) -> Optional[OfferRule]:
    """Rollback para versão específica."""
    history = await get_rule_history(rule_id)
    target = None
    for v in history:
        if v.version == to_version:
            target = v
            break

    if not target:
        return None

    return await update_rule(rule_id, target.model_dump(exclude={"id", "version", "created_at", "updated_at"}))


async def deactivate_rule(rule_id: str) -> Optional[OfferRule]:
    """Desativa uma regra (soft delete)."""
    return await update_rule(rule_id, {"is_active": False})


# =====================================================================
# SIMULATE: Impacto de mudança de regra
# =====================================================================


async def simulate_rule_impact(
    rule: OfferRule,
    historical_deals: list[dict],
) -> dict:
    """Simula impacto de uma regra nos deals históricos.

    Retorna: quantos deals seriam afetados, mudanças de parcelas/entrada, etc.
    """
    affected = 0
    total = len(historical_deals)

    for deal in historical_deals:
        grade_str = deal.get("g4_risk_grade", "")
        bu = deal.get("bu", "")
        amount = float(deal.get("amount", 0))

        try:
            grade = RiskGrade(grade_str)
        except ValueError:
            continue

        if grade in rule.grades:
            if rule.bus == ["*"] or bu in rule.bus:
                if rule.amount_min <= amount <= rule.amount_max:
                    affected += 1

    return {
        "total_deals_analyzed": total,
        "deals_affected": affected,
        "impact_pct": round(affected / max(total, 1) * 100, 1),
        "rule_name": rule.name,
        "grades": [g.value for g in rule.grades],
    }
