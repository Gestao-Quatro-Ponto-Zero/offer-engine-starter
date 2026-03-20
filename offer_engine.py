"""Offer Engine — Motor de regras que transforma score em menu de pagamento.

Baseado nas políticas comerciais reais da G4 Educação (Notion, Mar/2026).

Condições-base G4 (extraídas do Notion):
  - Cartão: até 12x (>3 meses), 8x (2 meses), 6x (1 mês antes do evento)
  - PIX: 40% entrada + 40% pré-evento + 20% pós (ou à vista com desconto)
  - Boleto: 50% entrada + 50% pré-evento
  - Ecossistema: Membros Club 30% desc, Scale 15% desc, Tools/Mentores 30%

Modulação por risco: faixas A+ a D ajustam parcelas, entrada, desconto e
aprovações — preservando a estrutura real de pagamento da G4.

Produtos/BUs: Scale, Club, Valley, G4peloBrasil, Poker, Jantar, Class, Skills
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from models import (
    OfferMenu,
    OfferRestrictions,
    OfferRule,
    OfferRuleRestrictions,
    OfferType,
    PaymentOption,
    PaymentOptionRule,
    RiskGrade,
    RiskScoreResult,
    SmartExitSuggestion,
)

# =====================================================================
# DEFAULT RULES — Política Comercial G4 Educação (Mar/2026)
#
# Referência: Notion > Políticas Comerciais > Política Comercial | 2026
# Formas de pagamento: Cartão (até 12x), Pix (com desconto), Boleto
# Descontos ecossistema: Club 30%, Scale 15%, Tools 30%, Mentores 30%
# =====================================================================

DEFAULT_RULES: list[OfferRule] = [
    # --- A+ (850-1000): Melhor perfil — condições máximas G4 ---
    # Cartão 12x sem juros, sem entrada. Pix com 10% desconto.
    # Espelha a condição "3+ meses antes" da política real.
    OfferRule(
        id="default_a_plus",
        name="A+ Premium — 12x sem juros, Pix 10%",
        grades=[RiskGrade.A_PLUS],
        options=[
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x sem juros no cartão",
                installments_max=12,
                down_payment_pct=0,
                interest_monthly_pct=0,
                recommended=True,
            ),
            PaymentOptionRule(
                type=OfferType.PIX,
                label_template="Pix à vista com {desconto}% de desconto",
                installments_max=1,
                discount_cash_pct=10,
            ),
            PaymentOptionRule(
                type=OfferType.CASH,
                label_template="Boleto: 50% entrada + 50% pré-evento",
                installments_max=1,
                down_payment_pct=50,
                discount_cash_pct=0,
            ),
        ],
        restrictions=OfferRuleRestrictions(
            requires_contract=True,
            requires_promissory_note=False,
            approval_manager_above=None,
            approval_director_above=None,
            credit_limit_max=500_000,
        ),
    ),
    # --- A (700-849): Bom perfil — condições competitivas ---
    # Cartão 10x sem juros com 10% entrada, ou 12x com juros.
    # Pix com 8% desconto. Espelha condição "2-3 meses antes".
    OfferRule(
        id="default_a",
        name="A Bom — 10x s/ juros + entrada, Pix 8%",
        grades=[RiskGrade.A],
        options=[
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x sem juros no cartão + {entrada}% entrada",
                installments_max=10,
                down_payment_pct=10,
                interest_monthly_pct=0,
                recommended=True,
            ),
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x no cartão ({juros}% a.m.) + {entrada}% entrada",
                installments_max=12,
                down_payment_pct=20,
                interest_monthly_pct=1.5,
            ),
            PaymentOptionRule(
                type=OfferType.PIX,
                label_template="Pix à vista com {desconto}% de desconto",
                installments_max=1,
                discount_cash_pct=8,
            ),
        ],
        restrictions=OfferRuleRestrictions(
            requires_contract=True,
            requires_promissory_note=False,
            approval_manager_above=200_000,
            approval_director_above=None,
            credit_limit_max=350_000,
        ),
    ),
    # --- B (500-699): Perfil moderado — condições com proteção ---
    # Cartão 8x sem juros com 20% entrada (similar "2 meses antes").
    # Pix com 5% desconto. Boleto com 50% entrada.
    OfferRule(
        id="default_b",
        name="B Moderado — 8x + 20% entrada, Pix 5%",
        grades=[RiskGrade.B],
        options=[
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x sem juros no cartão + {entrada}% entrada",
                installments_max=8,
                down_payment_pct=20,
                interest_monthly_pct=0,
                recommended=True,
            ),
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x no cartão ({juros}% a.m.) + {entrada}% entrada",
                installments_max=10,
                down_payment_pct=30,
                interest_monthly_pct=2.0,
            ),
            PaymentOptionRule(
                type=OfferType.PIX,
                label_template="Pix à vista com {desconto}% de desconto",
                installments_max=1,
                discount_cash_pct=5,
            ),
        ],
        restrictions=OfferRuleRestrictions(
            requires_contract=True,
            requires_promissory_note=True,
            approval_manager_above=100_000,
            approval_director_above=None,
            credit_limit_max=200_000,
        ),
    ),
    # --- C (300-499): Perfil restrito — condições conservadoras ---
    # Cartão 6x sem juros com 40% entrada (similar "1 mês antes").
    # Pix com 3% desconto. Aprovação gerente obrigatória.
    # Pagamento estruturado: início diferido + caução + promissória.
    OfferRule(
        id="default_c",
        name="C Restrito — 6x + 40% entrada, Pix 3%",
        grades=[RiskGrade.C],
        options=[
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x sem juros no cartão + {entrada}% entrada",
                installments_max=6,
                down_payment_pct=40,
                interest_monthly_pct=0,
                recommended=True,
            ),
            PaymentOptionRule(
                type=OfferType.STRUCTURED,
                label_template="Estruturado: {parcelas}x início em 60 dias + {entrada}% caução",
                installments_max=6,
                down_payment_pct=40,
                interest_monthly_pct=0,
            ),
            PaymentOptionRule(
                type=OfferType.PIX,
                label_template="Pix à vista com {desconto}% de desconto",
                installments_max=1,
                discount_cash_pct=3,
            ),
        ],
        restrictions=OfferRuleRestrictions(
            requires_contract=True,
            requires_promissory_note=True,
            approval_manager_above=0,  # sempre requer gerente
            approval_director_above=200_000,
            credit_limit_max=100_000,
        ),
    ),
    # --- D (0-299): Alto risco — apenas Pix ou cartão mínimo ---
    # Pix à vista com 3% ou cartão 3x com 50% entrada.
    # Pagamento estruturado: fecha deal sem aumentar risco.
    # Requer aprovação diretor em qualquer valor.
    OfferRule(
        id="default_d",
        name="D Alto Risco — Pix ou 3x + 50% entrada",
        grades=[RiskGrade.D],
        options=[
            PaymentOptionRule(
                type=OfferType.PIX,
                label_template="Pix à vista com {desconto}% de desconto",
                installments_max=1,
                discount_cash_pct=3,
                recommended=True,
            ),
            PaymentOptionRule(
                type=OfferType.INSTALLMENT,
                label_template="{parcelas}x no cartão + {entrada}% entrada",
                installments_max=3,
                down_payment_pct=50,
                interest_monthly_pct=0,
            ),
            PaymentOptionRule(
                type=OfferType.STRUCTURED,
                label_template="Estruturado: {parcelas}x início em 60 dias + {entrada}% caução",
                installments_max=3,
                down_payment_pct=60,
                interest_monthly_pct=0,
            ),
        ],
        restrictions=OfferRuleRestrictions(
            requires_contract=True,
            requires_promissory_note=True,
            approval_manager_above=0,
            approval_director_above=0,
            credit_limit_max=50_000,
        ),
    ),
]

# =====================================================================
# DESCONTOS ECOSSISTEMA G4 (extraído do Notion, Fev/2026)
# Aplicados sobre preço face quando o comprador é membro G4.
# =====================================================================

ECOSYSTEM_DISCOUNTS: dict[str, float] = {
    "club": 30.0,       # Membros Club: 30% sobre preço face
    "scale": 15.0,      # Membros Scale: 15% sobre preço face
    "tools": 30.0,      # Tools: 30% sobre preço face
    "tools_fee": 40.0,  # Tools com fee: 40% sobre preço face
    "mentores": 30.0,   # Mentores: 30% sobre preço face
}

# Teto absoluto em R$ para descontos ecossistema.
# Para deals grandes (R$300k+), 40% vira problema de margem.
ECOSYSTEM_CAP_ABSOLUTE: float = 80_000.0  # Max R$80k de desconto independente do %


# =====================================================================
# CÁLCULOS FINANCEIROS
# =====================================================================


def _compute_installment_value(
    principal: float,
    n_installments: int,
    monthly_rate_pct: float,
) -> float:
    """Calcula valor da parcela (Price/SAC simplificado).

    Se juros == 0: divisão simples.
    Se juros > 0: tabela Price (PMT).
    """
    if n_installments <= 0:
        return principal

    if monthly_rate_pct <= 0:
        return round(principal / n_installments, 2)

    # Tabela Price: PMT = PV * [r(1+r)^n] / [(1+r)^n - 1]
    r = monthly_rate_pct / 100
    factor = (r * (1 + r) ** n_installments) / ((1 + r) ** n_installments - 1)
    return round(principal * factor, 2)


def _compute_total_with_interest(
    installment_value: float,
    n_installments: int,
    down_payment: float,
) -> float:
    """Valor total pago (entrada + parcelas)."""
    return round(down_payment + installment_value * n_installments, 2)


# =====================================================================
# OFFER RESOLVER
# =====================================================================


def find_applicable_rules(
    grade: RiskGrade,
    bu: str,
    amount: float,
    custom_rules: Optional[list[OfferRule]] = None,
) -> list[OfferRule]:
    """Encontra regras aplicáveis para o contexto do deal.

    Prioridade: custom_rules (do rules_store) > DEFAULT_RULES.
    """
    rules_pool = custom_rules if custom_rules else DEFAULT_RULES

    applicable = []
    for rule in rules_pool:
        if not rule.is_active:
            continue
        if grade not in rule.grades:
            continue
        if rule.bus != ["*"] and bu not in rule.bus:
            continue
        if not (rule.amount_min <= amount <= rule.amount_max):
            continue
        applicable.append(rule)

    # Se custom rules não encontrou, fallback para default
    if not applicable and custom_rules:
        return find_applicable_rules(grade, bu, amount, custom_rules=None)

    return applicable


def resolve_offer(
    rule: OfferRule,
    deal_amount: float,
    credit_available: float,
) -> list[PaymentOption]:
    """Transforma uma regra em opções de pagamento concretas com valores calculados."""
    options = []

    for i, opt_rule in enumerate(rule.options):
        offer_id = f"offer_{uuid.uuid4().hex[:8]}"
        needs_appr = _needs_approval(deal_amount, rule.restrictions, is_director=False)
        prom_note = rule.restrictions.requires_promissory_note

        if opt_rule.type in (OfferType.CASH, OfferType.PIX):
            # Pix ou à vista com desconto
            discount_value = deal_amount * (opt_rule.discount_cash_pct / 100)
            total = deal_amount - discount_value

            options.append(PaymentOption(
                id=offer_id,
                type=opt_rule.type,
                label=opt_rule.label_template.format(
                    desconto=opt_rule.discount_cash_pct,
                ),
                recommended=opt_rule.recommended,
                installments=1,
                down_payment_pct=100,
                down_payment_value=round(total, 2),
                interest_monthly_pct=0,
                installment_value=round(total, 2),
                total_value=round(total, 2),
                discount_pct=opt_rule.discount_cash_pct,
                requires_approval=needs_appr,
                requires_promissory_note=prom_note,
            ))

        elif opt_rule.type == OfferType.STRUCTURED:
            # Pagamento estruturado: início diferido (60 dias) + caução + promissória
            down_pct = opt_rule.down_payment_pct
            down_value = round(deal_amount * (down_pct / 100), 2)  # caução
            financed = deal_amount - down_value
            n = opt_rule.installments_max

            installment_value = _compute_installment_value(financed, n, 0)
            total = _compute_total_with_interest(installment_value, n, down_value)

            label = opt_rule.label_template.format(
                parcelas=n,
                entrada=int(down_pct) if down_pct == int(down_pct) else down_pct,
                juros=0,
                desconto=0,
            )

            options.append(PaymentOption(
                id=offer_id,
                type=OfferType.STRUCTURED,
                label=label,
                recommended=opt_rule.recommended,
                installments=n,
                down_payment_pct=down_pct,
                down_payment_value=down_value,
                interest_monthly_pct=0,
                installment_value=installment_value,
                total_value=total,
                discount_pct=0,
                requires_approval=True,  # Sempre requer aprovação
                requires_promissory_note=True,  # Sempre requer promissória
            ))

        else:
            # Parcelado no cartão — máximo absoluto: 12x
            down_pct = opt_rule.down_payment_pct
            down_value = round(deal_amount * (down_pct / 100), 2)
            financed = deal_amount - down_value
            n = min(opt_rule.installments_max, 12)  # teto 12x cartão
            rate = opt_rule.interest_monthly_pct

            installment_value = _compute_installment_value(financed, n, rate)
            total = _compute_total_with_interest(installment_value, n, down_value)

            label = opt_rule.label_template.format(
                parcelas=n,
                entrada=int(down_pct) if down_pct == int(down_pct) else down_pct,
                juros=rate,
                desconto=0,
            )

            options.append(PaymentOption(
                id=offer_id,
                type=OfferType.INSTALLMENT,
                label=label,
                recommended=opt_rule.recommended,
                installments=n,
                down_payment_pct=down_pct,
                down_payment_value=down_value,
                interest_monthly_pct=rate,
                installment_value=installment_value,
                total_value=total,
                discount_pct=0,
                requires_approval=needs_appr,
                requires_promissory_note=prom_note,
            ))

    return options


def _needs_approval(
    amount: float,
    restrictions: OfferRuleRestrictions,
    is_director: bool = False,
) -> bool:
    """Verifica se precisa aprovação com base no valor e restrições."""
    if is_director and restrictions.approval_director_above is not None:
        return amount >= restrictions.approval_director_above
    if restrictions.approval_manager_above is not None:
        return amount >= restrictions.approval_manager_above
    return False


# =====================================================================
# OVERRIDES
# =====================================================================


def apply_overrides(
    options: list[PaymentOption],
    rule: OfferRule,
    deal_context: Optional[dict] = None,
) -> list[PaymentOption]:
    """Aplica overrides contextuais (recompra, campanha, ecossistema, field sales).

    Overrides baseados na política comercial G4:
      - Recompra (bom histórico): +2 parcelas cartão
      - Campanha ativa: +3 parcelas, -10pp entrada
      - Field Sales: +2 parcelas
      - Ecossistema G4 (Club/Scale/Tools/Mentores): desconto adicional no Pix
    """
    if not deal_context:
        return options

    is_recompra = deal_context.get("is_recompra", False)
    is_campanha = deal_context.get("campanha_ativa", False)
    is_field_sales = deal_context.get("is_field_sales", False)
    membro_tipo = deal_context.get("membro_g4", "")  # "club", "scale", etc.

    MAX_INSTALLMENTS = 12  # teto absoluto: cartão máx 12x

    for opt in options:
        # Ecossistema G4: desconto adicional no Pix para membros
        if opt.type in (OfferType.CASH, OfferType.PIX) and membro_tipo:
            extra_discount = ECOSYSTEM_DISCOUNTS.get(membro_tipo, 0)
            if extra_discount > 0:
                # Aplica desconto ecossistema sobre valor já com desconto base (cap %)
                opt.discount_pct = min(opt.discount_pct + extra_discount, 40)
                # Cap absoluto em R$: desconto nunca ultrapassa ECOSYSTEM_CAP_ABSOLUTE
                deal_original = opt.total_value / (1 - (opt.discount_pct - extra_discount) / 100) if (opt.discount_pct - extra_discount) < 100 else opt.total_value
                discount_value = deal_original * (opt.discount_pct / 100)
                if discount_value > ECOSYSTEM_CAP_ABSOLUTE:
                    # Recalcula % efetivo para não ultrapassar o cap
                    opt.discount_pct = round((ECOSYSTEM_CAP_ABSOLUTE / deal_original) * 100, 1)
            continue

        if opt.type in (OfferType.CASH, OfferType.PIX):
            continue

        # Recompra com histórico bom: +2 parcelas
        if is_recompra and deal_context.get("historico_pagamento") == "excelente":
            opt.installments = min(opt.installments + 2, MAX_INSTALLMENTS)

        # Campanha ativa: +3 parcelas, -10pp entrada
        if is_campanha:
            opt.installments = min(opt.installments + 3, MAX_INSTALLMENTS)
            new_down = max(0, opt.down_payment_pct - 10)
            opt.down_payment_pct = new_down

        # Field Sales: +2 parcelas
        if is_field_sales:
            opt.installments = min(opt.installments + 2, MAX_INSTALLMENTS)

    # Recalcular valores financeiros após overrides
    for opt in options:
        if opt.type in (OfferType.CASH, OfferType.PIX):
            # Recalcular com novo desconto
            deal_amount = opt.total_value / (1 - opt.discount_pct / 100) if opt.discount_pct < 100 else opt.total_value
            # Recupera valor original se discount mudou
            continue
        else:
            # Recalcular parcelas e totais
            if opt.installments > 0:
                financed = opt.total_value - opt.down_payment_value
                if financed > 0 and opt.installments > 0:
                    new_installment = _compute_installment_value(
                        financed, opt.installments, opt.interest_monthly_pct
                    )
                    opt.installment_value = new_installment
                    opt.total_value = _compute_total_with_interest(
                        new_installment, opt.installments, opt.down_payment_value
                    )

    return options


# =====================================================================
# MAIN: GERAR MENU DE OFERTAS
# =====================================================================


def generate_offer_menu(
    score_result: RiskScoreResult,
    deal_amount: float,
    bu: str = "Scale",
    custom_rules: Optional[list[OfferRule]] = None,
    deal_context: Optional[dict] = None,
    validity_days: int = 7,
) -> OfferMenu:
    """Gera menu completo de ofertas de pagamento.

    Este é o entry point principal do Offer Engine.

    Args:
        score_result: Resultado do scoring composto
        deal_amount: Valor do deal
        bu: Business Unit
        custom_rules: Regras customizadas (do rules_store)
        deal_context: Contexto adicional (recompra, campanha, etc.)
        validity_days: Dias de validade da oferta

    Returns:
        OfferMenu com 2-3 opções prontas
    """
    grade = score_result.grade
    credit_available = score_result.credit_available

    # 1. Encontrar regras aplicáveis
    rules = find_applicable_rules(grade, bu, deal_amount, custom_rules)

    if not rules:
        # Fallback extremo: regra D
        rules = [DEFAULT_RULES[-1]]

    rule = rules[0]  # Pega a primeira regra aplicável (mais específica)

    # 2. Verificar limite de crédito
    effective_amount = min(deal_amount, credit_available)
    if effective_amount <= 0:
        # Sem crédito disponível: apenas à vista
        rule = DEFAULT_RULES[-1]  # Regra D
        effective_amount = deal_amount

    # 3. Resolver opções com cálculos financeiros
    options = resolve_offer(rule, deal_amount, credit_available)

    # 4. Aplicar overrides contextuais
    options = apply_overrides(options, rule, deal_context)

    # 5. Smart Exits: sugestões inteligentes quando deal excede limite
    smart_exits: list[SmartExitSuggestion] = []
    credit_max = rule.restrictions.credit_limit_max

    if deal_amount > credit_max:
        excess = deal_amount - credit_max
        excess_ratio = deal_amount / credit_max if credit_max > 0 else 999

        # Sugestão 1: Split em contratos menores
        if excess_ratio >= 1.5:
            n_contracts = 2 if excess_ratio < 3 else 3
            amount_each = round(deal_amount / n_contracts, 2)
            smart_exits.append(SmartExitSuggestion(
                type="split_contract",
                label=f"Dividir em {n_contracts} contratos de {amount_each:,.0f}",
                description=(
                    f"Cada contrato fica dentro do limite de "
                    f"R${credit_max:,.0f} da faixa {grade.value}, "
                    f"mantendo as mesmas condições de pagamento."
                ),
                params={"contracts": n_contracts, "amount_each": amount_each},
            ))

        # Sugestão 2: Entrada mínima para liberar
        min_down_pct = round((excess / deal_amount) * 100, 1)
        min_down_value = round(excess, 2)
        smart_exits.append(SmartExitSuggestion(
            type="min_down_payment",
            label=f"Exigir R${min_down_value:,.0f} de entrada ({min_down_pct}%)",
            description=(
                f"Com entrada de R${min_down_value:,.0f}, o saldo financiado "
                f"fica em R${credit_max:,.0f} — dentro do limite da faixa."
            ),
            params={"min_down_pct": min_down_pct, "min_down_value": min_down_value},
        ))

        # Sugestão 3: Pagamento estruturado (C e D)
        if grade in (RiskGrade.C, RiskGrade.D):
            smart_exits.append(SmartExitSuggestion(
                type="structured_payment",
                label="Pagamento estruturado com início diferido",
                description=(
                    "Caução + promissória digital + início em 60 dias. "
                    "Fecha o deal sem aumentar exposição ao risco."
                ),
                params={"deferred_days": 60, "requires_caution": True},
            ))

    # 6. Construir restrições
    restrictions = OfferRestrictions(
        max_credit_limit=score_result.credit_limit,
        available_credit=credit_available,
        approval_required_above=rule.restrictions.approval_manager_above,
        promissory_required_above=(
            deal_amount if rule.restrictions.requires_promissory_note else None
        ),
        smart_exits=smart_exits,
    )

    now = datetime.now(timezone.utc)

    return OfferMenu(
        deal_id=score_result.deal_id,
        grade=grade,
        offers=options,
        restrictions=restrictions,
        valid_until=now + timedelta(days=validity_days),
        generated_at=now,
    )
