-- ── News sources registry ────────────────────────────────────────────────────
create table public.news_sources (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  homepage_url      text not null,
  feed_url          text,
  tier              int  not null check (tier in (1, 2)),
  access_status     text not null default 'active'
                    check (access_status in (
                      'active',
                      'manual_review_required',
                      'paywalled',
                      'inactive'
                    )),
  full_fetch_needed boolean not null default false,
  notes             text,
  last_fetched_at   timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ── News articles ─────────────────────────────────────────────────────────────
-- status: pending_analysis → analyzing → analyzed → included | excluded | error
create table public.news_articles (
  id                   uuid primary key default gen_random_uuid(),
  source_id            uuid references public.news_sources(id) not null,
  title                text not null,
  url                  text not null unique,
  published_at         timestamptz,
  raw_content          text,
  content_truncated    boolean default false,
  ingested_at          timestamptz default now(),

  status               text not null default 'pending_analysis'
                       check (status in (
                         'pending_analysis',
                         'analyzing',
                         'analyzed',
                         'included',
                         'excluded',
                         'error'
                       )),

  ai_summary           text,
  ai_impact_assessment text,
  ai_audience_tag      text check (ai_audience_tag in (
                         'sponsor', 'vendor', 'both', 'low_relevance'
                       )),
  ai_relevance_score   int check (ai_relevance_score between 1 and 10),
  ai_error             text,
  analyzed_at          timestamptz,

  created_at           timestamptz default now()
);

create index news_articles_source_id_idx    on public.news_articles (source_id);
create index news_articles_published_at_idx on public.news_articles (published_at desc);
create index news_articles_status_idx       on public.news_articles (status);

-- ── Newsletter drafts ─────────────────────────────────────────────────────────
-- status: pending_approval → published | discarded
create table public.newsletter_drafts (
  id                  uuid primary key default gen_random_uuid(),
  draft_date          date not null unique,
  status              text not null default 'pending_approval'
                      check (status in ('pending_approval', 'published', 'discarded')),
  relevance_threshold int  not null default 5,
  intro_text          text,
  sponsor_section     text,
  vendor_section      text,
  article_count       int,
  published_at        timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ── Draft <-> article join ────────────────────────────────────────────────────
create table public.newsletter_draft_articles (
  draft_id   uuid references public.newsletter_drafts(id) on delete cascade,
  article_id uuid references public.news_articles(id),
  section    text check (section in ('sponsor', 'vendor', 'both')),
  primary key (draft_id, article_id)
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.news_sources             enable row level security;
alter table public.news_articles            enable row level security;
alter table public.newsletter_drafts        enable row level security;
alter table public.newsletter_draft_articles enable row level security;

-- Sources: authenticated users read; service role writes
create policy "authenticated read sources"
  on public.news_sources for select to authenticated using (true);

-- Articles: authenticated users read; service role writes
create policy "authenticated read articles"
  on public.news_articles for select to authenticated using (true);

-- Drafts: anyone reads published; authenticated reads all; authenticated edits
create policy "public read published drafts"
  on public.newsletter_drafts for select to anon
  using (status = 'published');

create policy "authenticated read all drafts"
  on public.newsletter_drafts for select to authenticated using (true);

create policy "authenticated update drafts"
  on public.newsletter_drafts for update to authenticated
  using (true) with check (true);

-- Draft articles join: authenticated read
create policy "authenticated read draft articles"
  on public.newsletter_draft_articles for select to authenticated using (true);

-- ── Seed: news sources ────────────────────────────────────────────────────────
insert into public.news_sources
  (name, homepage_url, feed_url, tier, access_status, full_fetch_needed, notes)
values
  (
    'Fierce Pharma',
    'https://www.fiercepharma.com',
    'https://www.fiercepharma.com/rss/xml',
    1, 'active', true,
    'Feed contains short teasers only; full article fetch enabled.'
  ),
  (
    'Fierce Biotech',
    'https://www.fiercebiotech.com',
    'https://www.fiercebiotech.com/rss/xml',
    1, 'active', true,
    'Feed contains short teasers only; full article fetch enabled.'
  ),
  (
    'STAT News (Pharma)',
    'https://www.statnews.com',
    'https://www.statnews.com/category/pharma/feed',
    1, 'active', false,
    'Pharma category feed. Substantial excerpts provided.'
  ),
  (
    'FDA Law Blog',
    'https://thefdalawblog.com',
    'https://thefdalawblog.com/feed/',
    1, 'active', false,
    'Hyman Phelps & McNamara. Full post text in feed. Site moved from fdalawblog.net in 2025.'
  ),
  (
    'ECA Academy GMP News',
    'https://www.gmp-compliance.org',
    'https://app.gxp-services.net/eca_newsfeed.xml',
    1, 'active', false,
    'ECA Academy public GMP/GDP news feed. Free access.'
  ),
  (
    'RAPS Regulatory Focus',
    'https://www.raps.org',
    null,
    1, 'manual_review_required', false,
    'RSS feed (RSSFeed.aspx) returns 404 as of June 2026. Check raps.org/news-and-articles manually each day.'
  ),
  (
    'ISPE Pharmaceutical Engineering',
    'https://ispe.org/pharmaceutical-engineering',
    null,
    1, 'manual_review_required', false,
    'No public RSS found. Magazine appears to be member-access only. Check ispe.org manually.'
  ),
  (
    'ECA GxP Newsletter',
    'https://www.gmp-compliance.org/gmp-newsletter',
    null,
    2, 'paywalled', false,
    'Email-only newsletter. Subscribe at gmp-compliance.org.'
  ),
  (
    'IPQ Newsletter',
    'https://www.ipqpubs.com',
    null,
    2, 'paywalled', false,
    'Subscription-only publication.'
  ),
  (
    'Pink Sheet (Citeline)',
    'https://pink.pharmaintelligence.informa.com',
    null,
    2, 'paywalled', false,
    'Citeline subscription required.'
  ),
  (
    'Scrip (Citeline)',
    'https://scrip.pharmaintelligence.informa.com',
    null,
    2, 'paywalled', false,
    'Citeline subscription required.'
  ),
  (
    'MedTech Insight (Citeline)',
    'https://medtech.pharmaintelligence.informa.com',
    null,
    2, 'paywalled', false,
    'Citeline subscription required.'
  ),
  (
    'Generics Bulletin',
    'https://generics.pharmaintelligence.informa.com',
    null,
    2, 'paywalled', false,
    'Citeline subscription required.'
  ),
  (
    'The Pharma Letter',
    'https://www.thepharmaletter.com',
    null,
    2, 'paywalled', false,
    'Subscription-only.'
  ),
  (
    'PDA Letter',
    'https://www.pda.org/pda-letter-portal',
    null,
    2, 'paywalled', false,
    'PDA member publication.'
  ),
  (
    'Health Beauty Wellness Insight',
    'https://www.informa.com',
    null,
    2, 'paywalled', false,
    'Informa subscription publication.'
  );
