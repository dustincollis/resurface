// Shared identity resolution for people and companies.
//
// Given a name or email string, finds or creates a canonical
// person/company record. Used by backfill, calendar-sync,
// jamie-webhook, and the parser.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";

// ============================================================
// Company resolution
// ============================================================

/** Find or create a company by name. Returns company id. */
export async function resolveCompany(
  client: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  const normalized = name.trim();
  if (!normalized) throw new Error("Empty company name");

  // Exact match on name (case-insensitive)
  const { data: exact } = await client
    .from("companies")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", normalized)
    .maybeSingle();

  if (exact) return exact.id;

  // Check aliases
  const { data: all } = await client
    .from("companies")
    .select("id, aliases")
    .eq("user_id", userId);

  for (const c of all ?? []) {
    const aliases: string[] = c.aliases ?? [];
    if (aliases.some((a: string) => a.toLowerCase() === normalized.toLowerCase())) {
      return c.id;
    }
  }

  // Create new
  const { data: created, error } = await client
    .from("companies")
    .insert({ user_id: userId, name: normalized })
    .select("id")
    .single();

  if (error) {
    // Race condition: another call created it
    if (error.code === "23505") {
      const { data: retry } = await client
        .from("companies")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", normalized)
        .single();
      return retry!.id;
    }
    throw error;
  }

  return created.id;
}

// ============================================================
// Person resolution
// ============================================================

/** Extract email domain from an email address */
function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.substring(at + 1).toLowerCase() : null;
}

/** Check if a string looks like an email address */
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

interface ResolvePersonOpts {
  /** The raw name or email string */
  raw: string;
  /** If known, the company this person belongs to */
  companyId?: string;
  /** If known, the email domain (used to auto-link to company) */
  domain?: string;
}

/** Find or create a person. Returns person id. */
export async function resolvePerson(
  client: SupabaseClient,
  userId: string,
  opts: ResolvePersonOpts
): Promise<string> {
  const raw = opts.raw.trim();
  if (!raw) throw new Error("Empty person identifier");

  const rawIsEmail = isEmail(raw);
  const email = rawIsEmail ? raw.toLowerCase() : null;
  const displayName = rawIsEmail ? emailToDisplayName(raw) : raw;
  const domain = opts.domain ?? (email ? emailDomain(email) : null);

  // 1. Try exact email match
  if (email) {
    const { data: byEmail } = await client
      .from("people")
      .select("id")
      .eq("user_id", userId)
      .ilike("email", email)
      .maybeSingle();

    if (byEmail) return byEmail.id;

    // Check aliases for email
    const { data: all } = await client
      .from("people")
      .select("id, aliases")
      .eq("user_id", userId);

    for (const p of all ?? []) {
      const aliases: string[] = p.aliases ?? [];
      if (aliases.some((a: string) => a.toLowerCase() === email)) {
        return p.id;
      }
    }
  }

  // 2. Try exact name match (case-insensitive)
  const { data: byName } = await client
    .from("people")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", displayName)
    .maybeSingle();

  if (byName) return byName.id;

  // 3. Check aliases for name
  {
    const { data: all } = await client
      .from("people")
      .select("id, aliases")
      .eq("user_id", userId);

    for (const p of all ?? []) {
      const aliases: string[] = p.aliases ?? [];
      if (aliases.some((a: string) => a.toLowerCase() === displayName.toLowerCase())) {
        return p.id;
      }
    }
  }

  // 4. Auto-resolve company from email domain if not provided
  let companyId = opts.companyId ?? null;
  if (!companyId && domain) {
    const { data: byDomain } = await client
      .from("companies")
      .select("id")
      .eq("user_id", userId)
      .ilike("domain", domain)
      .maybeSingle();

    if (byDomain) companyId = byDomain.id;
  }

  // 5. Create new person
  const insertData: Record<string, unknown> = {
    user_id: userId,
    name: displayName,
    company_id: companyId,
  };
  if (email) {
    insertData.email = email;
    // If the display name differs from raw, store raw as alias
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
    // Race / duplicate name — find and return existing
    if (error.code === "23505") {
      const { data: retry } = await client
        .from("people")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", displayName)
        .maybeSingle();
      if (retry) return retry.id;
    }
    throw error;
  }

  return created.id;
}

/** Resolve multiple attendee strings, returning person IDs. Skips empties. */
export async function resolveAttendees(
  client: SupabaseClient,
  userId: string,
  attendees: string[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of attendees) {
    if (!raw.trim()) continue;
    // Skip generic speaker labels
    if (/^speaker\s*\d+$/i.test(raw.trim())) continue;
    try {
      const id = await resolvePerson(client, userId, { raw });
      ids.push(id);
    } catch (err) {
      console.warn(`[resolve-identity] skipping attendee "${raw}":`, err);
    }
  }
  return [...new Set(ids)];
}
