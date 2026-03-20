"""Testes do Offer Engine — validação de regras e cálculos financeiros."""

import sys
from pathlib import Path

# Adicionar parent ao path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (
    OfferMenu,
    OfferRestrictions,
    OfferType,
    PaymentOption,
    RiskGrade,
    RiskScoreResult,
    ScoreComponent,
)
from offer_engine import (
    _compute_installment_value,
    _compute_total_with_interest,
    find_applicable_rules,
    generate_offer_menu,
    resolve_offer,
    DEFAULT_RULES,
)
from datetime import datetime, timezone


# =====================================================================
# FIXTURES
# =====================================================================

def _make_score(score: int, grade: RiskGrade, credit_limit: float = 300_000) -> RiskScoreResult:
    now = datetime.now(timezone.utc)
    return RiskScoreResult(
        deal_id="test_deal_001",
        g4_risk_score=score,
        grade=grade,
        components={
            "internal": ScoreComponent(score=score, weight=0.5, contribution=score * 0.5),
            "bureau": ScoreComponent(score=score, weight=0.3, contribution=score * 0.3),
            "behavioral": ScoreComponent(score=score, weight=0.2, contribution=score * 0.2),
        },
        credit_limit=credit_limit,
        credit_available=credit_limit,
        top_factors=[],
        scored_at=now,
    )


# =====================================================================
# TESTES DE CÁLCULOS FINANCEIROS
# =====================================================================


def test_installment_no_interest():
    """Parcela sem juros = divisão simples."""
    val = _compute_installment_value(10000, 10, 0)
    assert val == 1000.0


def test_installment_with_interest():
    """Parcela com juros (tabela Price)."""
    val = _compute_installment_value(10000, 10, 2.0)
    # PMT = 10000 * [0.02 * 1.02^10] / [1.02^10 - 1]
    assert 1100 < val < 1150  # ~1113.27


def test_installment_single():
    """1 parcela = valor cheio."""
    val = _compute_installment_value(10000, 1, 0)
    assert val == 10000.0


def test_total_with_interest():
    total = _compute_total_with_interest(1000, 10, 5000)
    assert total == 15000.0  # 5000 + 10 * 1000


# =====================================================================
# TESTES DE REGRAS
# =====================================================================


def test_find_rules_a_plus():
    """Faixa A+ deve encontrar regra default."""
    rules = find_applicable_rules(RiskGrade.A_PLUS, "Scale", 50000)
    assert len(rules) >= 1
    assert RiskGrade.A_PLUS in rules[0].grades


def test_find_rules_d():
    """Faixa D deve encontrar regra restritiva."""
    rules = find_applicable_rules(RiskGrade.D, "Scale", 50000)
    assert len(rules) >= 1
    assert RiskGrade.D in rules[0].grades


def test_find_rules_all_grades():
    """Todas as faixas devem ter pelo menos uma regra."""
    for grade in RiskGrade:
        rules = find_applicable_rules(grade, "Scale", 50000)
        assert len(rules) >= 1, f"No rules for grade {grade.value}"


# =====================================================================
# TESTES DE GERAÇÃO DE MENU
# =====================================================================


def test_generate_menu_a_plus():
    """Menu A+ deve ter 3 opções, primeira recomendada."""
    score = _make_score(900, RiskGrade.A_PLUS, 500_000)
    menu = generate_offer_menu(score, deal_amount=45000, bu="Scale")

    assert isinstance(menu, OfferMenu)
    assert menu.grade == RiskGrade.A_PLUS
    assert len(menu.offers) == 3
    assert menu.offers[0].recommended is True

    # A+ deve ter opção sem juros e sem entrada
    first = menu.offers[0]
    assert first.interest_monthly_pct == 0
    assert first.down_payment_pct == 0
    assert first.installments == 12


def test_generate_menu_d():
    """Menu D deve ter poucas opções, restritivas."""
    score = _make_score(200, RiskGrade.D, 50_000)
    menu = generate_offer_menu(score, deal_amount=30000, bu="Scale")

    assert menu.grade == RiskGrade.D
    assert len(menu.offers) <= 3

    # Todas devem exigir aprovação
    for offer in menu.offers:
        assert offer.requires_approval is True


def test_generate_menu_values_consistent():
    """Valores do menu devem ser matematicamente consistentes."""
    score = _make_score(750, RiskGrade.A, 300_000)
    menu = generate_offer_menu(score, deal_amount=100000, bu="Scale")

    for offer in menu.offers:
        if offer.type in (OfferType.CASH, OfferType.PIX):
            # À vista / Pix: total < deal_amount (desconto)
            assert offer.total_value <= 100000
        else:
            # Parcelado no cartão: máximo 12x
            assert offer.installments <= 12
            assert offer.total_value >= offer.down_payment_value
            # Parcela * n_parcelas + entrada ≈ total
            calc_total = offer.installment_value * offer.installments + offer.down_payment_value
            assert abs(calc_total - offer.total_value) < 1  # tolerância de R$1


def test_generate_menu_credit_limit():
    """Menu deve respeitar limite de crédito."""
    score = _make_score(900, RiskGrade.A_PLUS, 500_000)
    menu = generate_offer_menu(score, deal_amount=45000, bu="Scale")

    assert menu.restrictions.max_credit_limit == 500_000
    assert menu.restrictions.available_credit <= 500_000


def test_menu_has_valid_until():
    """Menu deve ter data de validade."""
    score = _make_score(750, RiskGrade.A, 300_000)
    menu = generate_offer_menu(score, deal_amount=50000, bu="Scale")

    assert menu.valid_until > menu.generated_at


def test_each_offer_has_unique_id():
    """Cada opção deve ter ID único."""
    score = _make_score(750, RiskGrade.A, 300_000)
    menu = generate_offer_menu(score, deal_amount=50000, bu="Scale")

    ids = [o.id for o in menu.offers]
    assert len(ids) == len(set(ids))


# =====================================================================
# TESTES DE CENÁRIOS REAIS G4
# =====================================================================


def test_scenario_scale_50k_good_client():
    """Cenário: Cliente Scale, R$50K, bom histórico (score 800)."""
    score = _make_score(800, RiskGrade.A, 300_000)
    menu = generate_offer_menu(score, deal_amount=50000, bu="Scale")

    assert menu.grade == RiskGrade.A
    # Deve ter opção parcelada sem juros
    no_interest = [o for o in menu.offers if o.interest_monthly_pct == 0 and o.type == OfferType.INSTALLMENT]
    assert len(no_interest) >= 1
    # Deve ter opção Pix com desconto
    pix = [o for o in menu.offers if o.type == OfferType.PIX]
    assert len(pix) >= 1
    assert pix[0].discount_pct > 0


def test_scenario_club_200k_new_client():
    """Cenário: Cliente Club, R$200K, novo (score 550 — faixa B)."""
    score = _make_score(550, RiskGrade.B, 200_000)
    menu = generate_offer_menu(score, deal_amount=200000, bu="Club")

    assert menu.grade == RiskGrade.B
    # Deve exigir aprovação (valor alto)
    installment_opts = [o for o in menu.offers if o.type == OfferType.INSTALLMENT]
    assert any(o.requires_approval for o in installment_opts)
    # Deve exigir nota promissória
    assert any(o.requires_promissory_note for o in menu.offers)


def test_scenario_skills_10k_risky():
    """Cenário: Skills, R$10K, cliente arriscado (score 350 — faixa C)."""
    score = _make_score(350, RiskGrade.C, 100_000)
    menu = generate_offer_menu(score, deal_amount=10000, bu="Skills")

    assert menu.grade == RiskGrade.C
    # Deve ter entrada alta na opção parcelada
    for offer in menu.offers:
        if offer.type == OfferType.INSTALLMENT:
            assert offer.down_payment_pct >= 40


# =====================================================================
# RUN
# =====================================================================

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
