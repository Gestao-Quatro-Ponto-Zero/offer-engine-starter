-- G4 Offer Engine - Database Schema

-- Rules for offer generation per grade/BU/amount
create table public.offer_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grades text[] not null default '{}',
  bus text[] not null default '{"*"}',
  amount_min numeric not null default 0,
  amount_max numeric not null default 999999999,
  options jsonb not null default '[]',
  restrictions jsonb not null default '{}',
  version integer not null default 1,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rule version history for rollback
create table public.offer_rules_history (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.offer_rules(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by text not null,
  created_at timestamptz not null default now()
);

-- Cached risk scores per deal
create table public.offer_scores (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  g4_risk_score integer not null,
  grade text not null,
  components jsonb not null default '{}',
  credit_limit numeric not null default 0,
  credit_available numeric not null default 0,
  top_factors jsonb not null default '[]',
  scored_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_offer_scores_deal_id on public.offer_scores(deal_id);

-- Generated offer menus per deal
create table public.offer_menus (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  score_id uuid not null references public.offer_scores(id),
  offers jsonb not null default '[]',
  restrictions jsonb not null default '{}',
  smart_exits jsonb,
  valid_until timestamptz not null,
  status text not null default 'generated',
  selected_offer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_offer_menus_deal_id on public.offer_menus(deal_id);

-- Exception requests and approvals
create table public.offer_exceptions (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  menu_id uuid not null references public.offer_menus(id),
  seller_email text not null,
  desired_conditions text not null,
  justification text not null,
  deal_amount numeric not null,
  current_grade text not null,
  approver_role text not null default 'manager',
  approver_email text,
  status text not null default 'pending',
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index idx_offer_exceptions_status on public.offer_exceptions(status);

-- Audit trail for all actions
create table public.offer_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  deal_id text,
  user_email text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_offer_audit_created on public.offer_audit(created_at desc);

-- Enable RLS
alter table public.offer_rules enable row level security;
alter table public.offer_rules_history enable row level security;
alter table public.offer_scores enable row level security;
alter table public.offer_menus enable row level security;
alter table public.offer_exceptions enable row level security;
alter table public.offer_audit enable row level security;

-- Policies: authenticated users can read all, only service_role can write
create policy "Authenticated users can read rules"
  on public.offer_rules for select
  to authenticated using (true);

create policy "Authenticated users can manage rules"
  on public.offer_rules for all
  to authenticated using (true) with check (true);

create policy "Authenticated users can read rule history"
  on public.offer_rules_history for select
  to authenticated using (true);

create policy "Authenticated users can insert rule history"
  on public.offer_rules_history for insert
  to authenticated with check (true);

create policy "Authenticated users can read scores"
  on public.offer_scores for select
  to authenticated using (true);

create policy "Authenticated users can insert scores"
  on public.offer_scores for insert
  to authenticated with check (true);

create policy "Authenticated users can read menus"
  on public.offer_menus for select
  to authenticated using (true);

create policy "Authenticated users can manage menus"
  on public.offer_menus for all
  to authenticated using (true) with check (true);

create policy "Authenticated users can read exceptions"
  on public.offer_exceptions for select
  to authenticated using (true);

create policy "Authenticated users can manage exceptions"
  on public.offer_exceptions for all
  to authenticated using (true) with check (true);

create policy "Authenticated users can read audit"
  on public.offer_audit for select
  to authenticated using (true);

create policy "Authenticated users can insert audit"
  on public.offer_audit for insert
  to authenticated with check (true);

-- Seed default rules
insert into public.offer_rules (name, grades, bus, amount_min, amount_max, options, restrictions, created_by) values
(
  'Grade A+ - Premium',
  '{"A+"}',
  '{"*"}',
  0, 500000,
  '[
    {"type": "parcelado", "label_template": "12x sem juros", "installments": 12, "down_payment_pct": 0, "interest_monthly_pct": 0, "discount_pct": 0, "recommended": true},
    {"type": "pix", "label_template": "Pix com 10% desconto", "installments": 1, "down_payment_pct": 100, "interest_monthly_pct": 0, "discount_pct": 10, "recommended": false},
    {"type": "avista", "label_template": "Boleto à vista", "installments": 1, "down_payment_pct": 50, "interest_monthly_pct": 0, "discount_pct": 5, "recommended": false}
  ]',
  '{"requires_contract": true, "requires_promissory_note": false, "approval_manager_above": null, "approval_director_above": null, "credit_limit_max": 500000}',
  'system'
),
(
  'Grade A - Bom Crédito',
  '{"A"}',
  '{"*"}',
  0, 300000,
  '[
    {"type": "parcelado", "label_template": "10x sem juros + entrada", "installments": 10, "down_payment_pct": 10, "interest_monthly_pct": 0, "discount_pct": 0, "recommended": true},
    {"type": "pix", "label_template": "Pix com 8% desconto", "installments": 1, "down_payment_pct": 100, "interest_monthly_pct": 0, "discount_pct": 8, "recommended": false},
    {"type": "avista", "label_template": "Boleto com entrada", "installments": 1, "down_payment_pct": 50, "interest_monthly_pct": 0, "discount_pct": 3, "recommended": false}
  ]',
  '{"requires_contract": true, "requires_promissory_note": false, "approval_manager_above": 200000, "approval_director_above": null, "credit_limit_max": 300000}',
  'system'
),
(
  'Grade B - Crédito Moderado',
  '{"B"}',
  '{"*"}',
  0, 200000,
  '[
    {"type": "parcelado", "label_template": "8x sem juros + entrada 20%", "installments": 8, "down_payment_pct": 20, "interest_monthly_pct": 0, "discount_pct": 0, "recommended": true},
    {"type": "pix", "label_template": "Pix com 5% desconto", "installments": 1, "down_payment_pct": 100, "interest_monthly_pct": 0, "discount_pct": 5, "recommended": false}
  ]',
  '{"requires_contract": true, "requires_promissory_note": true, "approval_manager_above": 100000, "approval_director_above": null, "credit_limit_max": 200000}',
  'system'
),
(
  'Grade C - Crédito Arriscado',
  '{"C"}',
  '{"*"}',
  0, 100000,
  '[
    {"type": "parcelado", "label_template": "6x sem juros + entrada 40%", "installments": 6, "down_payment_pct": 40, "interest_monthly_pct": 0, "discount_pct": 0, "recommended": true},
    {"type": "pix", "label_template": "Pix com 3% desconto", "installments": 1, "down_payment_pct": 100, "interest_monthly_pct": 0, "discount_pct": 3, "recommended": false},
    {"type": "estruturado", "label_template": "Estruturado 60d + caução", "installments": 6, "down_payment_pct": 40, "interest_monthly_pct": 1.5, "discount_pct": 0, "recommended": false}
  ]',
  '{"requires_contract": true, "requires_promissory_note": true, "approval_manager_above": 0, "approval_director_above": null, "credit_limit_max": 100000}',
  'system'
),
(
  'Grade D - Alto Risco',
  '{"D"}',
  '{"*"}',
  0, 50000,
  '[
    {"type": "pix", "label_template": "Pix com 3% desconto", "installments": 1, "down_payment_pct": 100, "interest_monthly_pct": 0, "discount_pct": 3, "recommended": true},
    {"type": "parcelado", "label_template": "3x + entrada 50%", "installments": 3, "down_payment_pct": 50, "interest_monthly_pct": 0, "discount_pct": 0, "recommended": false},
    {"type": "estruturado", "label_template": "Estruturado c/ caução e promissória", "installments": 3, "down_payment_pct": 50, "interest_monthly_pct": 2, "discount_pct": 0, "recommended": false}
  ]',
  '{"requires_contract": true, "requires_promissory_note": true, "approval_manager_above": 0, "approval_director_above": 0, "credit_limit_max": 50000}',
  'system'
);
