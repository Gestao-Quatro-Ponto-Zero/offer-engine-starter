#!/usr/bin/env python3
"""
G4 Offer Engine — Backtest Risk Score Analysis
================================================
Reads the Databricks query results (500 customers), computes a simplified
G4 Risk Score for each, and outputs summary analytics + full results to JSON.

Score = w1*ML_Internal + w2*Behavioral + w3*Bureau_Proxy
      = 0.50*Internal  + 0.20*Behavioral + 0.30*Bureau_Proxy

Grade thresholds: A+ (850-1000), A (700-849), B (500-699), C (300-499), D (0-299)
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATA_FILE = (
    "/Users/tallisgomes/.claude/projects/-Users-tallisgomes-Documents-g4-OS/"
    "4a9955c0-a2ff-47aa-9c7e-6564a1431776/tool-results/"
    "mcp-databricks-genie_get_query_result-1773363154203.txt"
)

OUTPUT_FILE = (
    "/Users/tallisgomes/Documents/g4 OS/"
    "sistema de cobrança g4/g4_offers/backtest_results.json"
)

WEIGHTS = {"internal": 0.45, "behavioral": 0.25, "bureau_proxy": 0.30}

GRADE_THRESHOLDS = [
    (850, "A+"),
    (700, "A"),
    (500, "B"),
    (300, "C"),
    (0, "D"),
]

# ---------------------------------------------------------------------------
# Column indices (from schema)
# ---------------------------------------------------------------------------
COL_NOME = 0
COL_RECEITA_TOTAL = 1
COL_NEGOCIACOES_GANHAS = 2
COL_PRODUTOS_COMPRADOS = 3
COL_CLUSTER_RFM = 4
COL_FAIXA_FATURAMENTO = 5
COL_DATA_PRIMEIRA_COMPRA = 6
COL_DATA_ULTIMA_COMPRA = 7
COL_COMPROU_GE = 8
COL_COMPROU_SCALE = 9
COL_COMPROU_CLUB = 10
COL_STATUS_FIN_SCALE = 11
COL_STATUS_FIN_CLUB = 12
COL_TOTAL_DEALS = 13
COL_DEALS_GANHOS = 14
COL_DEALS_PERDIDOS = 15
COL_RECEITA_GANHOS = 16
COL_MOTIVOS_LOST = 17
COL_METODOS_PAGAMENTO = 18


# ---------------------------------------------------------------------------
# Helper: safe type conversions
# ---------------------------------------------------------------------------

def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_int(val: Any, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def safe_bool(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    return str(val).lower() == "true"


def safe_str(val: Any, default: str = "") -> str:
    if val is None:
        return default
    return str(val)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data() -> list[list]:
    """Load the Databricks JSON result and return the data_array (500 rows)."""
    print(f"[1/5] Loading data from:\n      {DATA_FILE}")
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        outer = json.load(f)

    inner_text = outer[0]["text"]
    inner = json.loads(inner_text)

    schema = inner["manifest"]["schema"]
    total_rows = inner["manifest"]["total_row_count"]
    columns = schema["columns"]
    data = inner["result"]["data_array"]

    print(f"      Schema: {len(columns)} columns, {total_rows} total rows")
    print(f"      Loaded: {len(data)} rows")
    print(f"      Columns: {', '.join(c['name'] for c in columns)}")

    return data


# ---------------------------------------------------------------------------
# Parse a single row into a structured dict
# ---------------------------------------------------------------------------

def parse_row(row: list) -> dict:
    """Convert raw string array into a typed dict."""
    # Count products from the JSON array
    produtos_count = 0
    if row[COL_PRODUTOS_COMPRADOS]:
        try:
            prods = json.loads(row[COL_PRODUTOS_COMPRADOS])
            produtos_count = len(prods)
        except (json.JSONDecodeError, TypeError):
            pass

    # Parse payment methods
    metodos_raw = []
    if row[COL_METODOS_PAGAMENTO]:
        try:
            metodos_raw = json.loads(row[COL_METODOS_PAGAMENTO])
        except (json.JSONDecodeError, TypeError):
            pass

    # Flatten payment methods (some entries are comma-separated combos)
    metodos_flat = []
    for m in metodos_raw:
        for part in m.split(","):
            p = part.strip()
            if p:
                metodos_flat.append(p)

    return {
        "nome": safe_str(row[COL_NOME]),
        "receita_total": safe_float(row[COL_RECEITA_TOTAL]),
        "negociacoes_ganhas": safe_int(row[COL_NEGOCIACOES_GANHAS]),
        "produtos_count": produtos_count,
        "cluster_rfm": safe_str(row[COL_CLUSTER_RFM]),
        "faixa_de_faturamento": safe_str(row[COL_FAIXA_FATURAMENTO]),
        "comprou_ge": safe_bool(row[COL_COMPROU_GE]),
        "comprou_scale": safe_bool(row[COL_COMPROU_SCALE]),
        "comprou_club": safe_bool(row[COL_COMPROU_CLUB]),
        "status_financeiro_scale": safe_str(row[COL_STATUS_FIN_SCALE]),
        "status_financeiro_club": safe_str(row[COL_STATUS_FIN_CLUB]),
        "total_deals": safe_int(row[COL_TOTAL_DEALS]),
        "deals_ganhos": safe_int(row[COL_DEALS_GANHOS]),
        "deals_perdidos": safe_int(row[COL_DEALS_PERDIDOS]),
        "receita_ganhos": safe_float(row[COL_RECEITA_GANHOS]),
        "metodos_pagamento": metodos_flat,
    }


# ---------------------------------------------------------------------------
# Scoring: ML Internal Score (50% weight)
# ---------------------------------------------------------------------------
#
# Based on: receita_total, negociacoes_ganhas, produtos_count,
#           deals_ganhos vs deals_perdidos ratio.
#
# This is a simplified proxy for the full G4 Collections ML model.
# We use percentile-based normalization against the dataset.
# ---------------------------------------------------------------------------

def compute_internal_scores(customers: list[dict]) -> list[float]:
    """Compute ML Internal Score (0-1000) for each customer.

    Sub-components:
      - receita_score (40%): log-scaled revenue percentile
      - negociacoes_score (20%): won negotiations count percentile
      - produtos_score (15%): product count percentile
      - win_ratio_score (25%): deals_ganhos / (deals_ganhos + deals_perdidos)
    """
    # Collect arrays for percentile normalization
    receitas = [c["receita_total"] for c in customers]
    negociacoes = [c["negociacoes_ganhas"] for c in customers]
    produtos = [c["produtos_count"] for c in customers]

    # Log-transform revenue for better spread
    log_receitas = [math.log1p(r) for r in receitas]
    max_log_r = max(log_receitas) if log_receitas else 1
    min_log_r = min(log_receitas) if log_receitas else 0
    range_log_r = max_log_r - min_log_r if max_log_r != min_log_r else 1

    max_neg = max(negociacoes) if negociacoes else 1
    max_prod = max(produtos) if produtos else 1

    scores = []
    for c in customers:
        # Revenue sub-score (0-1000)
        log_r = math.log1p(c["receita_total"])
        receita_score = ((log_r - min_log_r) / range_log_r) * 1000

        # Negociacoes ganhas sub-score (0-1000)
        neg_score = (c["negociacoes_ganhas"] / max_neg) * 1000 if max_neg > 0 else 0

        # Produtos count sub-score (0-1000)
        prod_score = min((c["produtos_count"] / max(max_prod, 1)) * 1000, 1000)

        # Win ratio sub-score (0-1000)
        # IMPORTANT: most "perdidos" are operational (SDR couldn't connect,
        # SLA, lead deprioritized) — NOT financial risk indicators.
        # So we dampen the penalty from high deal counts.
        total_relevant = c["deals_ganhos"] + c["deals_perdidos"]
        if total_relevant > 0:
            raw_ratio = c["deals_ganhos"] / total_relevant
            # Apply sqrt to ratio to be less punitive for low ratios
            # (someone with 2 wins / 120 total isn't 60x riskier than 1:1)
            adjusted_ratio = math.sqrt(raw_ratio) if raw_ratio > 0 else 0
            # Confidence saturates at 5 deals (more sensitive)
            confidence = min(total_relevant / 5, 1.0)
            win_ratio_score = adjusted_ratio * 700 + confidence * 300
        else:
            win_ratio_score = 300  # neutral if no deals data

        # Loyalty bonus: customers with receita > 100k AND ganhos >= 3
        loyalty_bonus = 0
        if c["receita_total"] > 100_000 and c["negociacoes_ganhas"] >= 3:
            loyalty_bonus = min(150, c["negociacoes_ganhas"] * 10)

        # Weighted combination
        internal = (
            receita_score * 0.40
            + neg_score * 0.20
            + prod_score * 0.15
            + win_ratio_score * 0.25
        ) + loyalty_bonus
        scores.append(max(0, min(1000, round(internal))))

    return scores


# ---------------------------------------------------------------------------
# Scoring: Behavioral Score (20% weight)
# ---------------------------------------------------------------------------
#
# Based on: cluster_rfm, faixa_de_faturamento,
#           comprou_ge/scale/club product breadth.
# ---------------------------------------------------------------------------

# Cluster RFM scoring: type + segment
CLUSTER_TYPE_SCORES = {
    "CF": 80,   # Customer-First: highest engagement tier
    "AB": 60,   # AB tier
    "GJ": 40,   # GJ tier
}

CLUSTER_SEGMENT_SCORES = {
    "Champions": 1000,
    "Loyal Customers": 850,
    "Potential Loyalists": 700,
    "Promising": 600,
    "New Customers": 550,
    "Need Attention": 400,
    "About To Sleep": 300,
    "At-Risk": 200,
    "Hibernating": 100,
}

FAIXA_SCORES = {
    "Acima de R$500 milhões": 1000,
    "De R$50 a R$500 milhões ao ano": 900,
    "De R$10 a R$50 milhões ao ano": 800,
    "De R$5 a R$10 milhões ao ano": 700,
    "De R$1 milhão a R$5 milhões ao ano": 600,
    "De R$500 mil a R$1 milhão ao ano": 500,
    "De R$250 mil a R$500 mil ao ano": 400,
    "Até R$500 mil ao ano": 350,
    "Até R$250 mil ao ano": 300,
    "Ainda não faturamos": 150,
}


def compute_behavioral_score(c: dict) -> float:
    """Compute Behavioral Score (0-1000) for a customer.

    Sub-components:
      - cluster_rfm_score (50%): RFM segment quality
      - faixa_score (25%): revenue band
      - product_breadth_score (25%): how many G4 lines purchased
    """
    # 1. Cluster RFM score
    cluster = c["cluster_rfm"]
    cluster_score = 300  # default for unknown/None
    if cluster and " - " in cluster:
        parts = cluster.split(" - ", 1)
        tier_code = parts[0].strip()
        segment = parts[1].strip()
        base_segment = CLUSTER_SEGMENT_SCORES.get(segment, 300)
        tier_bonus = CLUSTER_TYPE_SCORES.get(tier_code, 50)
        # Combine: segment drives 90%, tier adds adjustment
        cluster_score = min(1000, base_segment * 0.90 + tier_bonus * 1.0)

    # 2. Faixa de faturamento score
    faixa = c["faixa_de_faturamento"]
    faixa_score = FAIXA_SCORES.get(faixa, 300)

    # 3. Product breadth score
    products_owned = sum([
        1 if c["comprou_ge"] else 0,
        1 if c["comprou_scale"] else 0,
        1 if c["comprou_club"] else 0,
    ])
    # 0 products = 200, 1 = 500, 2 = 800, 3 = 1000
    breadth_map = {0: 200, 1: 500, 2: 800, 3: 1000}
    breadth_score = breadth_map.get(products_owned, 200)

    # 4. Multi-product synergy bonus (exponential, not linear)
    synergy_bonus = 0
    if products_owned >= 2:
        synergy_bonus = 100 * (products_owned - 1)  # +100 for 2, +200 for 3

    behavioral = (
        cluster_score * 0.45
        + faixa_score * 0.25
        + breadth_score * 0.30
    ) + synergy_bonus
    return max(0, min(1000, round(behavioral)))


# ---------------------------------------------------------------------------
# Scoring: Bureau Proxy Score (30% weight)
# ---------------------------------------------------------------------------
#
# Since we don't have Serasa, we use:
#   - status_financeiro_scale/club (Adimplente = high, Inadimplente = low)
#   - metodos_pagamento (PIX = good, credit card = medium, boleto = lower)
#   - deals_perdidos count (more = worse)
# ---------------------------------------------------------------------------

STATUS_SCORES = {
    "adimplente": 900,
    "distrato": 400,
    "inadimplente": 150,
    "": 500,         # unknown / null => neutral
}

PAYMENT_METHOD_SCORES = {
    "PIX": 800,                     # immediate payment = good signal
    "CREDITCARD": 600,              # standard
    "RECURRENT_CREDITCARD": 700,    # recurring = commitment
    "RECURRENT_BANKSLIP": 650,      # recurring boleto
    "BANKSLIP": 500,                # boleto = slightly lower
    "DEBITCARD": 650,               # debit = immediate
    "GOBANK": 500,                  # neutral
    "PRINCIPIA": 500,               # neutral
    "pagamento externo": 400,       # external = less visibility
}


def compute_bureau_proxy_score(c: dict, max_deals_perdidos: int) -> float:
    """Compute Bureau Proxy Score (0-1000) for a customer.

    Sub-components:
      - financial_status_score (30%): best of scale/club status
      - payment_method_score (20%): average of payment methods used
      - loss_ratio_score (25%): ratio-based, not absolute count
      - monetary_commitment_score (25%): receita_ganhos as proxy for reliability
    """
    # 1. Financial status (best of scale/club)
    scale_status = c["status_financeiro_scale"].lower().strip()
    club_status = c["status_financeiro_club"].lower().strip()

    scale_score = STATUS_SCORES.get(scale_status, 500)
    club_score = STATUS_SCORES.get(club_status, 500)

    has_status_data = bool(scale_status) or bool(club_status)
    if scale_status and club_status:
        financial_score = max(scale_score, club_score)
    elif scale_status:
        financial_score = scale_score
    elif club_status:
        financial_score = club_score
    else:
        financial_score = 500  # no data = neutral

    # 2. Payment method score (average of all methods used)
    if c["metodos_pagamento"]:
        method_scores = [
            PAYMENT_METHOD_SCORES.get(m, 500)
            for m in c["metodos_pagamento"]
        ]
        payment_score = sum(method_scores) / len(method_scores)
        # Diversity bonus: using multiple payment methods = flexibility
        if len(set(c["metodos_pagamento"])) >= 2:
            payment_score = min(1000, payment_score + 80)
    else:
        payment_score = 500  # no data = neutral

    # 3. Loss ratio score — use RATIO not absolute count
    # This is fairer: someone with 2/120 deals won has ratio 0.017
    # vs someone with 0/5 deals won has ratio 0.0
    total_deals = c["deals_ganhos"] + c["deals_perdidos"]
    if total_deals > 0:
        win_pct = c["deals_ganhos"] / total_deals
        # Apply sigmoid-like curve: win_pct > 0.3 is good, < 0.05 is bad
        if win_pct >= 0.3:
            loss_score = 800 + min(200, (win_pct - 0.3) * 400)
        elif win_pct >= 0.05:
            loss_score = 400 + (win_pct - 0.05) / 0.25 * 400
        else:
            loss_score = max(150, win_pct * 8000)
    else:
        loss_score = 400  # no data = slightly below neutral

    # 4. Monetary commitment — receita_ganhos as proxy for reliability
    # Someone who already spent R$500k with G4 is a proven payer
    receita = c["receita_ganhos"]
    if receita >= 500_000:
        monetary_score = 1000
    elif receita >= 100_000:
        monetary_score = 700 + (receita - 100_000) / 400_000 * 300
    elif receita >= 10_000:
        monetary_score = 400 + (receita - 10_000) / 90_000 * 300
    elif receita > 0:
        monetary_score = 200 + (receita / 10_000) * 200
    else:
        monetary_score = 150  # never paid

    bureau_proxy = (
        financial_score * 0.30
        + payment_score * 0.20
        + loss_score * 0.25
        + monetary_score * 0.25
    )
    return max(0, min(1000, round(bureau_proxy)))


# ---------------------------------------------------------------------------
# Composite Score & Grading
# ---------------------------------------------------------------------------

def score_to_grade(score: int) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "D"


def compute_composite_scores(customers: list[dict]) -> list[dict]:
    """Compute full G4 Risk Score for all customers."""
    print("[2/5] Computing risk scores...")

    # Pre-compute internal scores (needs dataset-level normalization)
    internal_scores = compute_internal_scores(customers)

    # Max deals_perdidos for bureau proxy normalization
    max_deals_perdidos = max(c["deals_perdidos"] for c in customers)

    results = []
    for i, c in enumerate(customers):
        internal = internal_scores[i]
        behavioral = compute_behavioral_score(c)
        bureau = compute_bureau_proxy_score(c, max_deals_perdidos)

        composite = round(
            internal * WEIGHTS["internal"]
            + behavioral * WEIGHTS["behavioral"]
            + bureau * WEIGHTS["bureau_proxy"]
        )

        # Convergence bonus: when all 3 dimensions agree strongly,
        # boost the score. This allows reaching A+ territory.
        min_component = min(internal, behavioral, bureau)
        if min_component >= 700:
            # All 3 strong → +80 bonus (enables A+ for truly excellent)
            composite += 80
        elif min_component >= 550:
            # All 3 above average → +40 bonus
            composite += 40
        elif min_component >= 400:
            # All 3 decent → +15 bonus
            composite += 15

        # Floor drag: if any component is very low, drag composite down
        if min_component < 200:
            composite -= 30

        composite = max(0, min(1000, composite))
        grade = score_to_grade(composite)

        results.append({
            "nome": c["nome"],
            "g4_risk_score": composite,
            "grade": grade,
            "components": {
                "internal": {"score": internal, "weight": WEIGHTS["internal"]},
                "behavioral": {"score": behavioral, "weight": WEIGHTS["behavioral"]},
                "bureau_proxy": {"score": bureau, "weight": WEIGHTS["bureau_proxy"]},
            },
            "raw_data": {
                "receita_total": c["receita_total"],
                "negociacoes_ganhas": c["negociacoes_ganhas"],
                "produtos_count": c["produtos_count"],
                "cluster_rfm": c["cluster_rfm"],
                "faixa_de_faturamento": c["faixa_de_faturamento"],
                "deals_ganhos": c["deals_ganhos"],
                "deals_perdidos": c["deals_perdidos"],
                "receita_ganhos": c["receita_ganhos"],
                "comprou_ge": c["comprou_ge"],
                "comprou_scale": c["comprou_scale"],
                "comprou_club": c["comprou_club"],
                "status_financeiro_scale": c["status_financeiro_scale"],
                "status_financeiro_club": c["status_financeiro_club"],
            },
        })

    return results


# ---------------------------------------------------------------------------
# Analysis & Reporting
# ---------------------------------------------------------------------------

def analyze_results(results: list[dict], customers: list[dict]) -> dict:
    """Generate comprehensive analytics from the scored results."""
    print("[3/5] Analyzing results...\n")

    scores = [r["g4_risk_score"] for r in results]
    grades = [r["grade"] for r in results]

    # -----------------------------------------------------------------------
    # Key Statistics
    # -----------------------------------------------------------------------
    mean_score = statistics.mean(scores)
    median_score = statistics.median(scores)
    stdev_score = statistics.stdev(scores) if len(scores) > 1 else 0
    min_score = min(scores)
    max_score = max(scores)

    print("=" * 70)
    print("G4 OFFER ENGINE — BACKTEST RISK SCORE ANALYSIS")
    print("=" * 70)
    print(f"\nDataset: {len(results)} customers")
    print(f"\nKey Statistics:")
    print(f"  Mean Score:   {mean_score:.1f}")
    print(f"  Median Score: {median_score:.1f}")
    print(f"  Std Dev:      {stdev_score:.1f}")
    print(f"  Min:          {min_score}")
    print(f"  Max:          {max_score}")

    # -----------------------------------------------------------------------
    # Grade Distribution
    # -----------------------------------------------------------------------
    grade_counts = Counter(grades)
    grade_order = ["A+", "A", "B", "C", "D"]
    grade_dist = {}

    print(f"\n{'='*70}")
    print("GRADE DISTRIBUTION")
    print(f"{'='*70}")
    print(f"  {'Grade':<8} {'Count':>8} {'Pct':>8} {'Avg Score':>10}")
    print(f"  {'-'*36}")

    for g in grade_order:
        count = grade_counts.get(g, 0)
        pct = (count / len(results)) * 100
        grade_scores = [r["g4_risk_score"] for r in results if r["grade"] == g]
        avg = statistics.mean(grade_scores) if grade_scores else 0
        print(f"  {g:<8} {count:>8} {pct:>7.1f}% {avg:>10.1f}")
        grade_dist[g] = {
            "count": count,
            "percentage": round(pct, 1),
            "avg_score": round(avg, 1),
        }

    # -----------------------------------------------------------------------
    # Only Wins vs Mixed (wins + losses)
    # -----------------------------------------------------------------------
    only_wins = [r for r, c in zip(results, customers)
                 if c["deals_ganhos"] > 0 and c["deals_perdidos"] == 0]
    mixed = [r for r, c in zip(results, customers)
             if c["deals_ganhos"] > 0 and c["deals_perdidos"] > 0]
    only_losses = [r for r, c in zip(results, customers)
                   if c["deals_ganhos"] == 0 and c["deals_perdidos"] > 0]
    no_deals = [r for r, c in zip(results, customers)
                if c["deals_ganhos"] == 0 and c["deals_perdidos"] == 0]

    print(f"\n{'='*70}")
    print("WIN/LOSS ANALYSIS")
    print(f"{'='*70}")

    segments_wl = {
        "Only Wins (ganhos>0, perdidos=0)": only_wins,
        "Mixed (ganhos>0, perdidos>0)": mixed,
        "Only Losses (ganhos=0, perdidos>0)": only_losses,
        "No Deals (ganhos=0, perdidos=0)": no_deals,
    }

    win_loss_analysis = {}
    for label, seg in segments_wl.items():
        if seg:
            seg_scores = [r["g4_risk_score"] for r in seg]
            avg_s = statistics.mean(seg_scores)
            med_s = statistics.median(seg_scores)
            print(f"  {label}:")
            print(f"    Count: {len(seg)}, Avg: {avg_s:.1f}, Median: {med_s:.1f}")
            win_loss_analysis[label] = {
                "count": len(seg),
                "avg_score": round(avg_s, 1),
                "median_score": round(med_s, 1),
            }
        else:
            print(f"  {label}: (none)")
            win_loss_analysis[label] = {"count": 0, "avg_score": 0, "median_score": 0}

    # -----------------------------------------------------------------------
    # Average Score by Cluster RFM
    # -----------------------------------------------------------------------
    cluster_groups = defaultdict(list)
    for r, c in zip(results, customers):
        cluster_groups[c["cluster_rfm"]].append(r["g4_risk_score"])

    print(f"\n{'='*70}")
    print("AVERAGE SCORE BY CLUSTER RFM")
    print(f"{'='*70}")
    print(f"  {'Cluster':<30} {'Count':>6} {'Avg':>8} {'Med':>8}")
    print(f"  {'-'*54}")

    cluster_analysis = {}
    for cluster in sorted(cluster_groups.keys(), key=lambda x: str(x)):
        s_list = cluster_groups[cluster]
        avg_s = statistics.mean(s_list)
        med_s = statistics.median(s_list)
        label = cluster if cluster else "(None)"
        print(f"  {label:<30} {len(s_list):>6} {avg_s:>8.1f} {med_s:>8.1f}")
        cluster_analysis[label] = {
            "count": len(s_list),
            "avg_score": round(avg_s, 1),
            "median_score": round(med_s, 1),
        }

    # -----------------------------------------------------------------------
    # Average Score by Faixa de Faturamento
    # -----------------------------------------------------------------------
    faixa_groups = defaultdict(list)
    for r, c in zip(results, customers):
        faixa_groups[c["faixa_de_faturamento"]].append(r["g4_risk_score"])

    print(f"\n{'='*70}")
    print("AVERAGE SCORE BY FAIXA DE FATURAMENTO")
    print(f"{'='*70}")
    print(f"  {'Faixa':<45} {'N':>5} {'Avg':>8} {'Med':>8}")
    print(f"  {'-'*68}")

    faixa_analysis = {}
    # Sort by FAIXA_SCORES descending
    sorted_faixas = sorted(
        faixa_groups.keys(),
        key=lambda x: FAIXA_SCORES.get(x, 0),
        reverse=True,
    )
    for faixa in sorted_faixas:
        s_list = faixa_groups[faixa]
        avg_s = statistics.mean(s_list)
        med_s = statistics.median(s_list)
        print(f"  {faixa:<45} {len(s_list):>5} {avg_s:>8.1f} {med_s:>8.1f}")
        faixa_analysis[faixa] = {
            "count": len(s_list),
            "avg_score": round(avg_s, 1),
            "median_score": round(med_s, 1),
        }

    # -----------------------------------------------------------------------
    # Top 10 Highest & Lowest Scores
    # -----------------------------------------------------------------------
    sorted_results = sorted(results, key=lambda r: r["g4_risk_score"], reverse=True)

    print(f"\n{'='*70}")
    print("TOP 10 HIGHEST SCORES")
    print(f"{'='*70}")
    print(f"  {'#':<4} {'Score':>6} {'Grade':<6} {'Name':<35} {'Receita':>12}")
    print(f"  {'-'*66}")
    top_10_high = []
    for i, r in enumerate(sorted_results[:10], 1):
        receita = r["raw_data"]["receita_total"]
        print(f"  {i:<4} {r['g4_risk_score']:>6} {r['grade']:<6} "
              f"{r['nome'][:35]:<35} R${receita:>11,.2f}")
        top_10_high.append({
            "rank": i,
            "nome": r["nome"],
            "score": r["g4_risk_score"],
            "grade": r["grade"],
            "receita_total": receita,
        })

    print(f"\n{'='*70}")
    print("TOP 10 LOWEST SCORES")
    print(f"{'='*70}")
    print(f"  {'#':<4} {'Score':>6} {'Grade':<6} {'Name':<35} {'Receita':>12}")
    print(f"  {'-'*66}")
    top_10_low = []
    for i, r in enumerate(sorted_results[-10:][::-1], 1):
        receita = r["raw_data"]["receita_total"]
        print(f"  {i:<4} {r['g4_risk_score']:>6} {r['grade']:<6} "
              f"{r['nome'][:35]:<35} R${receita:>11,.2f}")
        top_10_low.append({
            "rank": i,
            "nome": r["nome"],
            "score": r["g4_risk_score"],
            "grade": r["grade"],
            "receita_total": receita,
        })

    # -----------------------------------------------------------------------
    # Correlation Analysis
    # -----------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("CORRELATION ANALYSIS")
    print(f"{'='*70}")

    # Simple Pearson correlation (manual, no numpy dependency)
    def pearson_corr(xs: list[float], ys: list[float]) -> float:
        n = len(xs)
        if n < 2:
            return 0.0
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
        dy = math.sqrt(sum((y - my) ** 2 for y in ys))
        if dx == 0 or dy == 0:
            return 0.0
        return num / (dx * dy)

    receitas_all = [c["receita_total"] for c in customers]
    neg_ganhas_all = [c["negociacoes_ganhas"] for c in customers]
    deals_ganhos_all = [c["deals_ganhos"] for c in customers]
    deals_perdidos_all = [c["deals_perdidos"] for c in customers]
    receita_ganhos_all = [c["receita_ganhos"] for c in customers]

    corr_receita = pearson_corr(scores, receitas_all)
    corr_neg_ganhas = pearson_corr(scores, neg_ganhas_all)
    corr_deals_ganhos = pearson_corr(scores, deals_ganhos_all)
    corr_deals_perdidos = pearson_corr(scores, deals_perdidos_all)
    corr_receita_ganhos = pearson_corr(scores, receita_ganhos_all)

    print(f"  Score vs Receita Total:        r = {corr_receita:+.4f}")
    print(f"  Score vs Negociacoes Ganhas:    r = {corr_neg_ganhas:+.4f}")
    print(f"  Score vs Deals Ganhos:          r = {corr_deals_ganhos:+.4f}")
    print(f"  Score vs Deals Perdidos:        r = {corr_deals_perdidos:+.4f}")
    print(f"  Score vs Receita Ganhos:        r = {corr_receita_ganhos:+.4f}")

    # Interpretation
    print(f"\n  Interpretation:")
    if corr_receita > 0.3:
        print(f"    [OK] Higher scores correlate positively with more revenue (r={corr_receita:.3f})")
    elif corr_receita > 0:
        print(f"    [WEAK] Slight positive correlation with revenue (r={corr_receita:.3f})")
    else:
        print(f"    [WARN] No positive correlation with revenue (r={corr_receita:.3f})")

    if corr_deals_perdidos < -0.1:
        print(f"    [OK] Higher scores correlate with fewer lost deals (r={corr_deals_perdidos:.3f})")
    elif corr_deals_perdidos < 0:
        print(f"    [WEAK] Slight inverse with lost deals (r={corr_deals_perdidos:.3f})")
    else:
        print(f"    [WARN] No inverse correlation with lost deals (r={corr_deals_perdidos:.3f})")

    if corr_deals_ganhos > 0.3:
        print(f"    [OK] Higher scores correlate with more won deals (r={corr_deals_ganhos:.3f})")

    correlations = {
        "score_vs_receita_total": round(corr_receita, 4),
        "score_vs_negociacoes_ganhas": round(corr_neg_ganhas, 4),
        "score_vs_deals_ganhos": round(corr_deals_ganhos, 4),
        "score_vs_deals_perdidos": round(corr_deals_perdidos, 4),
        "score_vs_receita_ganhos": round(corr_receita_ganhos, 4),
    }

    # -----------------------------------------------------------------------
    # Component-level analysis
    # -----------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("COMPONENT SCORE DISTRIBUTIONS")
    print(f"{'='*70}")

    for comp_name in ["internal", "behavioral", "bureau_proxy"]:
        comp_scores = [r["components"][comp_name]["score"] for r in results]
        c_mean = statistics.mean(comp_scores)
        c_med = statistics.median(comp_scores)
        c_std = statistics.stdev(comp_scores) if len(comp_scores) > 1 else 0
        c_min = min(comp_scores)
        c_max = max(comp_scores)
        weight = WEIGHTS[comp_name]
        print(f"\n  {comp_name.upper()} (weight={weight:.0%}):")
        print(f"    Mean={c_mean:.1f}, Median={c_med:.1f}, Std={c_std:.1f}, "
              f"Min={c_min}, Max={c_max}")

    # -----------------------------------------------------------------------
    # Validation metrics: grade monotonicity
    # -----------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("VALIDATION METRICS")
    print(f"{'='*70}")

    # Check that avg receita increases with grade
    grade_avg_receita = {}
    for g in grade_order:
        g_customers = [c for r, c in zip(results, customers) if r["grade"] == g]
        if g_customers:
            grade_avg_receita[g] = statistics.mean([c["receita_total"] for c in g_customers])
        else:
            grade_avg_receita[g] = 0

    print(f"\n  Average Receita by Grade (higher grade should = higher receita):")
    monotonic = True
    prev_val = float("inf")
    for g in grade_order:
        val = grade_avg_receita[g]
        marker = " OK" if val <= prev_val else " !! NOT MONOTONIC"
        if val > prev_val:
            monotonic = False
        print(f"    {g}: R${val:,.2f}{marker}")
        prev_val = val

    # Check that avg deals_perdidos decreases with grade
    grade_avg_losses = {}
    for g in grade_order:
        g_customers = [c for r, c in zip(results, customers) if r["grade"] == g]
        if g_customers:
            grade_avg_losses[g] = statistics.mean([c["deals_perdidos"] for c in g_customers])
        else:
            grade_avg_losses[g] = 0

    print(f"\n  Average Deals Perdidos by Grade (higher grade should = fewer losses):")
    loss_monotonic = True
    prev_val = 0
    for g in grade_order:
        val = grade_avg_losses[g]
        marker = " OK" if val >= prev_val else " !! NOT MONOTONIC"
        if val < prev_val:
            loss_monotonic = False
        print(f"    {g}: {val:.1f}{marker}")
        prev_val = val

    validation = {
        "receita_monotonic_by_grade": monotonic,
        "losses_monotonic_by_grade": loss_monotonic,
        "grade_avg_receita": {g: round(v, 2) for g, v in grade_avg_receita.items()},
        "grade_avg_losses": {g: round(v, 1) for g, v in grade_avg_losses.items()},
    }

    print(f"\n  Receita monotonically decreases with grade: {'YES' if monotonic else 'NO'}")
    print(f"  Losses monotonically increase with lower grade: {'YES' if loss_monotonic else 'NO'}")

    # -----------------------------------------------------------------------
    # Assemble full analytics dict
    # -----------------------------------------------------------------------
    analytics = {
        "summary_stats": {
            "total_customers": len(results),
            "mean_score": round(mean_score, 1),
            "median_score": round(median_score, 1),
            "std_dev": round(stdev_score, 1),
            "min_score": min_score,
            "max_score": max_score,
        },
        "grade_distribution": grade_dist,
        "win_loss_analysis": win_loss_analysis,
        "cluster_rfm_analysis": cluster_analysis,
        "faixa_faturamento_analysis": faixa_analysis,
        "top_10_highest": top_10_high,
        "top_10_lowest": top_10_low,
        "correlations": correlations,
        "validation": validation,
        "weights_used": WEIGHTS,
        "grade_thresholds": {g: t for t, g in GRADE_THRESHOLDS},
    }

    return analytics


# ---------------------------------------------------------------------------
# Save Results
# ---------------------------------------------------------------------------

def save_results(results: list[dict], analytics: dict):
    """Save full results + analytics to JSON."""
    print(f"\n[4/5] Saving results to:\n      {OUTPUT_FILE}")

    output = {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_file": DATA_FILE,
            "scoring_version": "backtest_v2.0_calibrated",
            "description": (
                "G4 Risk Score backtest on 500 customers. "
                "Simplified scoring without ML model or Serasa bureau. "
                "Uses receita/deals/cluster as proxy signals."
            ),
        },
        "analytics": analytics,
        "customer_scores": [
            {
                "nome": r["nome"],
                "g4_risk_score": r["g4_risk_score"],
                "grade": r["grade"],
                "components": r["components"],
            }
            for r in results
        ],
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"      Saved {len(results)} customer scores ({size_kb:.1f} KB)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("\n" + "=" * 70)
    print("  G4 OFFER ENGINE — BACKTEST RISK SCORE ANALYSIS")
    print("=" * 70 + "\n")

    # 1. Load data
    data = load_data()

    # 2. Parse rows
    print(f"\n[1.5/5] Parsing {len(data)} rows...")
    customers = [parse_row(row) for row in data]
    print(f"        Parsed {len(customers)} customers successfully")

    # 3. Compute scores
    results = compute_composite_scores(customers)

    # 4. Analyze
    analytics = analyze_results(results, customers)

    # 5. Save
    save_results(results, analytics)

    print(f"\n[5/5] Done!")
    print(f"      Results: {OUTPUT_FILE}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
