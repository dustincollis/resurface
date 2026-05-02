-- Companies kind: distinguish partners from clients from internal-EPAM
-- entities. The existing /companies/:id page treats every company the
-- same; partners need their own surface (joint-pursuit lens, partner
-- contacts, partnership notes) that doesn't make sense for clients.
--
-- 'unknown' is the default — most existing companies haven't been
-- classified yet. We seed the known content partners by name match in
-- this same migration; everything else stays unknown until manually
-- tagged.

alter table companies
  add column kind text not null default 'unknown'
    check (kind in ('partner', 'client', 'internal', 'other', 'unknown'));

-- Index: every query that filters by kind will skip the bulk 'unknown'
-- rows; partial index on the meaningful values keeps it tight.
create index idx_companies_kind
  on companies(user_id, kind)
  where kind != 'unknown';

-- Seed the known content partners by name match. Case-insensitive so
-- existing data with different capitalization gets caught. The user
-- supplied this list directly: Adobe, Sitecore, Contentful, Contentstack,
-- Orange Logic, Storyblok, Sanity, Gradial, Acquia, Coveo, AWS, Algolia.
update companies
  set kind = 'partner'
  where lower(name) in (
    'adobe',
    'sitecore',
    'contentful',
    'contentstack',
    'orange logic',
    'storyblok',
    'sanity',
    'gradial',
    'acquia',
    'coveo',
    'aws',
    'algolia'
  );
