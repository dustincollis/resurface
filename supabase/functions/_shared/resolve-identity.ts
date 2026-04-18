// Shared identity resolution for people and companies.
//
// Load-once, in-memory resolver. The old implementation made 4-6 queries
// per resolvePerson call (including two full-table scans for aliases),
// and resolveAttendees serially iterated. A calendar-sync with 100
// attendees was 400+ round trips.
//
// The resolver preloads people + companies once, then resolves in-memory
// and bulk-inserts new rows. resolveAttendees batches; per-item resolves
// also benefit because a single request can pass one resolver instance
// to many resolvePerson / resolveCompany calls.
//
// Backwards compat: the free functions (resolvePerson, resolveCompany,
// resolveAttendees) still exist as one-shot wrappers for callers that
// don't want to manage a resolver.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";

// ============================================================
// Helpers
// ============================================================

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.substring(at + 1).toLowerCase() : null;
}

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/** Turn "Holly_Quinones@epam.com" into "Holly Quinones" */
function emailToDisplayName(email: string): string {
  const local = email.split("@")[0];
  return local
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

interface PersonRow {
  id: string;
  email: string | null;
  name: string;
  aliases: string[] | null;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  aliases: string[] | null;
}

// ============================================================
// Resolver — holds in-memory indexes, creates on demand
// ============================================================

export interface ResolvePersonOpts {
  /** The raw name or email string */
  raw: string;
  /** If known, the company this person belongs to */
  companyId?: string | null;
  /** If known, the email domain (used to auto-link to company) */
  domain?: string | null;
}

export interface IdentityResolver {
  preload(): Promise<void>;
  resolvePerson(opts: ResolvePersonOpts): Promise<string>;
  resolveCompany(name: string): Promise<string>;
  resolveAttendees(attendees: string[]): Promise<string[]>;
}

export function createIdentityResolver(
  client: SupabaseClient,
  userId: string
): IdentityResolver {
  // In-memory indexes. Populated lazily by preload().
  let loaded = false;
  const peopleByEmail = new Map<string, string>();
  const peopleByName = new Map<string, string>();
  const peopleByAlias = new Map<string, string>();
  const companiesByName = new Map<string, string>();
  const companiesByDomain = new Map<string, string>();
  const companiesByAlias = new Map<string, string>();

  async function preload(): Promise<void> {
    if (loaded) return;
    const [peopleRes, companiesRes] = await Promise.all([
      client
        .from("people")
        .select("id, email, name, aliases")
        .eq("user_id", userId),
      client
        .from("companies")
        .select("id, name, domain, aliases")
        .eq("user_id", userId),
    ]);

    for (const p of (peopleRes.data as PersonRow[] | null) ?? []) {
      if (p.email) peopleByEmail.set(p.email.toLowerCase(), p.id);
      if (p.name) peopleByName.set(p.name.toLowerCase(), p.id);
      for (const a of p.aliases ?? []) {
        if (a) peopleByAlias.set(a.toLowerCase(), p.id);
      }
    }
    for (const c of (companiesRes.data as CompanyRow[] | null) ?? []) {
      if (c.name) companiesByName.set(c.name.toLowerCase(), c.id);
      if (c.domain) companiesByDomain.set(c.domain.toLowerCase(), c.id);
      for (const a of c.aliases ?? []) {
        if (a) companiesByAlias.set(a.toLowerCase(), c.id);
      }
    }
    loaded = true;
  }

  function lookupPerson(email: string | null, displayName: string): string | null {
    if (email) {
      const byE = peopleByEmail.get(email);
      if (byE) return byE;
      const byEA = peopleByAlias.get(email);
      if (byEA) return byEA;
    }
    const n = displayName.toLowerCase();
    const byN = peopleByName.get(n);
    if (byN) return byN;
    const byNA = peopleByAlias.get(n);
    if (byNA) return byNA;
    return null;
  }

  function lookupCompanyByDomain(domain: string | null): string | null {
    if (!domain) return null;
    return companiesByDomain.get(domain.toLowerCase()) ?? null;
  }

  async function resolvePerson(opts: ResolvePersonOpts): Promise<string> {
    await preload();
    const raw = opts.raw.trim();
    if (!raw) throw new Error("Empty person identifier");

    const rawIsEmail = isEmail(raw);
    const email = rawIsEmail ? raw.toLowerCase() : null;
    const displayName = rawIsEmail ? emailToDisplayName(raw) : raw;

    const found = lookupPerson(email, displayName);
    if (found) return found;

    const domain = opts.domain ?? (email ? emailDomain(email) : null);
    const companyId = opts.companyId ?? lookupCompanyByDomain(domain);

    const insertData: Record<string, unknown> = {
      user_id: userId,
      name: displayName,
      company_id: companyId,
    };
    if (email) {
      insertData.email = email;
      if (displayName.toLowerCase() !== raw.toLowerCase()) {
        insertData.aliases = [raw.toLowerCase()];
      }
    }

    const { data: created, error } = await client
      .from("people")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      // Race / duplicate — fall back to a single SELECT, then cache.
      if (error.code === "23505") {
        const { data: retry } = await client
          .from("people")
          .select("id")
          .eq("user_id", userId)
          .ilike("name", displayName)
          .maybeSingle();
        if (retry) {
          peopleByName.set(displayName.toLowerCase(), retry.id);
          return retry.id;
        }
      }
      throw error;
    }

    // Update in-memory indexes so subsequent calls in this request hit cache
    if (email) peopleByEmail.set(email, created.id);
    peopleByName.set(displayName.toLowerCase(), created.id);
    return created.id;
  }

  async function resolveCompany(name: string): Promise<string> {
    await preload();
    const normalized = name.trim();
    if (!normalized) throw new Error("Empty company name");
    const key = normalized.toLowerCase();

    const cached = companiesByName.get(key) ?? companiesByAlias.get(key);
    if (cached) return cached;

    const { data: created, error } = await client
      .from("companies")
      .insert({ user_id: userId, name: normalized })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: retry } = await client
          .from("companies")
          .select("id")
          .eq("user_id", userId)
          .ilike("name", normalized)
          .maybeSingle();
        if (retry) {
          companiesByName.set(key, retry.id);
          return retry.id;
        }
      }
      throw error;
    }

    companiesByName.set(key, created.id);
    return created.id;
  }

  async function resolveAttendees(attendees: string[]): Promise<string[]> {
    await preload();

    // Dedup + filter out generic speaker labels. Preserve first-seen order.
    const uniqueRaws: string[] = [];
    const seenKeys = new Set<string>();
    for (const raw of attendees) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (/^speaker\s*\d+$/i.test(trimmed)) continue;
      const key = trimmed.toLowerCase();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueRaws.push(trimmed);
    }
    if (uniqueRaws.length === 0) return [];

    // Classify — existing vs needs-create
    const idByRawKey = new Map<string, string>();
    const toCreate: Array<{ raw: string; email: string | null; name: string }> = [];
    for (const raw of uniqueRaws) {
      const rawIsEmail = isEmail(raw);
      const email = rawIsEmail ? raw.toLowerCase() : null;
      const displayName = rawIsEmail ? emailToDisplayName(raw) : raw;
      const found = lookupPerson(email, displayName);
      if (found) {
        idByRawKey.set(raw.toLowerCase(), found);
      } else {
        toCreate.push({ raw, email, name: displayName });
      }
    }

    // Bulk insert new people in one round trip
    if (toCreate.length > 0) {
      const rows = toCreate.map(({ raw, email, name }) => {
        const domain = email ? emailDomain(email) : null;
        const companyId = lookupCompanyByDomain(domain);
        const row: Record<string, unknown> = {
          user_id: userId,
          name,
          company_id: companyId,
        };
        if (email) {
          row.email = email;
          if (name.toLowerCase() !== raw.toLowerCase()) {
            row.aliases = [raw.toLowerCase()];
          }
        }
        return row;
      });

      const { data: inserted, error } = await client
        .from("people")
        .insert(rows)
        .select("id, email, name");

      if (error) {
        // Bulk failed — fall back to single-row resolvePerson for each,
        // which handles 23505 race individually.
        console.warn("[resolve-identity] bulk insert failed, falling back:", error.message);
        for (const c of toCreate) {
          try {
            const id = await resolvePerson({ raw: c.raw });
            idByRawKey.set(c.raw.toLowerCase(), id);
          } catch (err) {
            console.warn(`[resolve-identity] skipping "${c.raw}":`, err);
          }
        }
      } else {
        for (let i = 0; i < (inserted ?? []).length; i++) {
          const row = inserted![i];
          const tc = toCreate[i];
          idByRawKey.set(tc.raw.toLowerCase(), row.id);
          // Update caches so any follow-on resolvePerson calls hit memory
          if (row.email) peopleByEmail.set(row.email.toLowerCase(), row.id);
          if (row.name) peopleByName.set(row.name.toLowerCase(), row.id);
        }
      }
    }

    // Return ids in input order, deduped
    const out: string[] = [];
    const seenIds = new Set<string>();
    for (const raw of attendees) {
      const id = idByRawKey.get(raw.trim().toLowerCase());
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        out.push(id);
      }
    }
    return out;
  }

  return { preload, resolvePerson, resolveCompany, resolveAttendees };
}

// ============================================================
// Backwards-compatible free functions
//
// These create a one-shot resolver per call. Callers that make many
// resolves in a single request should use createIdentityResolver()
// directly to share the in-memory cache.
// ============================================================

export async function resolvePerson(
  client: SupabaseClient,
  userId: string,
  opts: ResolvePersonOpts
): Promise<string> {
  return createIdentityResolver(client, userId).resolvePerson(opts);
}

export async function resolveCompany(
  client: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  return createIdentityResolver(client, userId).resolveCompany(name);
}

export async function resolveAttendees(
  client: SupabaseClient,
  userId: string,
  attendees: string[]
): Promise<string[]> {
  return createIdentityResolver(client, userId).resolveAttendees(attendees);
}
