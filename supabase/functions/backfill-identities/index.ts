// backfill-identities: scans existing data to create people + company records.
//
// Optimized for speed: reads all data upfront, deduplicates in memory,
// then writes in batches. Safe to run multiple times.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.substring(at + 1).toLowerCase() : null;
}

function emailToDisplayName(email: string): string {
  const local = email.split("@")[0];
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const userId = Deno.env.get("RESURFACE_DEFAULT_USER_ID");
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "RESURFACE_DEFAULT_USER_ID not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // Phase 1: Collect all unique company names and person identifiers
    // ============================================================

    const companyNames = new Set<string>();
    const personRaws = new Set<string>();

    // From pursuits
    const { data: pursuits } = await admin
      .from("pursuits")
      .select("id, company")
      .eq("user_id", userId)
      .not("company", "is", null);

    for (const p of pursuits ?? []) {
      if (p.company?.trim()) companyNames.add(p.company.trim());
    }

    // From commitments
    const { data: commitments } = await admin
      .from("commitments")
      .select("id, company, counterpart")
      .eq("user_id", userId);

    for (const c of commitments ?? []) {
      if (c.company?.trim()) companyNames.add(c.company.trim());
      if (c.counterpart?.trim() && !/^the\s/i.test(c.counterpart.trim())) {
        personRaws.add(c.counterpart.trim());
      }
    }

    // From items.custom_fields.company
    const { data: items } = await admin
      .from("items")
      .select("id, custom_fields")
      .eq("user_id", userId);

    for (const item of items ?? []) {
      const cf = (item.custom_fields ?? {}) as Record<string, unknown>;
      const co = cf.company as string | undefined;
      if (co?.trim()) companyNames.add(co.trim());
    }

    // From meetings.attendees
    const { data: meetings } = await admin
      .from("meetings")
      .select("id, attendees")
      .eq("user_id", userId)
      .not("attendees", "is", null);

    for (const m of meetings ?? []) {
      for (const a of (m.attendees ?? []) as string[]) {
        const t = a.trim();
        if (t && !/^speaker\s*\d+$/i.test(t)) {
          personRaws.add(t);
          // Also extract company domain from emails
          if (isEmail(t)) {
            const domain = emailDomain(t);
            if (domain) {
              // We'll use domains to link people to companies later
            }
          }
        }
      }
    }

    // ============================================================
    // Phase 2: Create companies (batch)
    // ============================================================

    // Deduplicate by lowercase
    const uniqueCompanies = new Map<string, string>(); // lowercase → original
    for (const name of companyNames) {
      const key = name.toLowerCase();
      if (!uniqueCompanies.has(key)) uniqueCompanies.set(key, name);
    }

    // Check existing
    const { data: existingCompanies } = await admin
      .from("companies")
      .select("id, name")
      .eq("user_id", userId);

    const companyMap = new Map<string, string>(); // lowercase name → id
    for (const c of existingCompanies ?? []) {
      companyMap.set(c.name.toLowerCase(), c.id);
    }

    // Insert missing
    const newCompanies: { user_id: string; name: string }[] = [];
    for (const [key, name] of uniqueCompanies) {
      if (!companyMap.has(key)) {
        newCompanies.push({ user_id: userId, name });
      }
    }

    if (newCompanies.length > 0) {
      const { data: inserted } = await admin
        .from("companies")
        .upsert(newCompanies, { onConflict: "user_id,lower(name)", ignoreDuplicates: true })
        .select("id, name");

      for (const c of inserted ?? []) {
        companyMap.set(c.name.toLowerCase(), c.id);
      }

      // Re-fetch if upsert didn't return all (can happen with ignoreDuplicates)
      if ((inserted ?? []).length < newCompanies.length) {
        const { data: allCo } = await admin
          .from("companies")
          .select("id, name")
          .eq("user_id", userId);
        for (const c of allCo ?? []) {
          companyMap.set(c.name.toLowerCase(), c.id);
        }
      }
    }

    // ============================================================
    // Phase 3: Create people (batch)
    // ============================================================

    // Build domain → company_id map
    const domainMap = new Map<string, string>();
    // Infer from company names that look like they match email domains
    // Also check company domains
    const { data: companiesWithDomain } = await admin
      .from("companies")
      .select("id, name, domain")
      .eq("user_id", userId);

    for (const c of companiesWithDomain ?? []) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), c.id);
    }

    // Check existing people
    const { data: existingPeople } = await admin
      .from("people")
      .select("id, name, email, aliases")
      .eq("user_id", userId);

    const personByName = new Map<string, string>(); // lowercase name → id
    const personByEmail = new Map<string, string>(); // lowercase email → id
    for (const p of existingPeople ?? []) {
      personByName.set(p.name.toLowerCase(), p.id);
      if (p.email) personByEmail.set(p.email.toLowerCase(), p.id);
      for (const a of (p.aliases ?? []) as string[]) {
        personByName.set(a.toLowerCase(), p.id);
      }
    }

    // Process each raw person identifier
    const newPeople: { user_id: string; name: string; email?: string; company_id?: string }[] = [];
    const seenNames = new Set<string>();

    for (const raw of personRaws) {
      const rawIsEmail = isEmail(raw);
      const email = rawIsEmail ? raw.toLowerCase() : null;
      const displayName = rawIsEmail ? emailToDisplayName(raw) : raw;
      const nameKey = displayName.toLowerCase();

      // Already exists?
      if (email && personByEmail.has(email)) continue;
      if (personByName.has(nameKey)) continue;
      if (seenNames.has(nameKey)) continue;

      seenNames.add(nameKey);

      // Try to find company from email domain
      let companyId: string | undefined;
      if (email) {
        const domain = emailDomain(email);
        if (domain) companyId = domainMap.get(domain);
      }

      const row: typeof newPeople[0] = {
        user_id: userId,
        name: displayName,
      };
      if (email) row.email = email;
      if (companyId) row.company_id = companyId;

      newPeople.push(row);
      personByName.set(nameKey, "pending");
    }

    if (newPeople.length > 0) {
      // Insert in chunks to avoid payload limits
      const CHUNK = 50;
      for (let i = 0; i < newPeople.length; i += CHUNK) {
        const chunk = newPeople.slice(i, i + CHUNK);
        await admin
          .from("people")
          .upsert(chunk, { ignoreDuplicates: true });
      }

      // Re-fetch all people
      const { data: allPeople } = await admin
        .from("people")
        .select("id, name, email, aliases")
        .eq("user_id", userId);

      personByName.clear();
      personByEmail.clear();
      for (const p of allPeople ?? []) {
        personByName.set(p.name.toLowerCase(), p.id);
        if (p.email) personByEmail.set(p.email.toLowerCase(), p.id);
        for (const a of (p.aliases ?? []) as string[]) {
          personByName.set(a.toLowerCase(), p.id);
        }
      }
    }

    // ============================================================
    // Phase 4: Link FKs on existing records
    // ============================================================

    // Helper: find person id for a raw string
    const findPerson = (raw: string): string | null => {
      const t = raw.trim();
      if (!t) return null;
      const email = isEmail(t) ? t.toLowerCase() : null;
      if (email && personByEmail.has(email)) return personByEmail.get(email)!;
      const name = email ? emailToDisplayName(t).toLowerCase() : t.toLowerCase();
      return personByName.get(name) ?? null;
    };

    // Helper: find company id
    const findCompany = (name: string): string | null => {
      return companyMap.get(name.trim().toLowerCase()) ?? null;
    };

    let pursuitLinked = 0;
    let commitmentLinked = 0;
    let itemLinked = 0;
    let meetingLinked = 0;

    // Link pursuits → company_id
    for (const p of pursuits ?? []) {
      if (!p.company?.trim()) continue;
      const cid = findCompany(p.company);
      if (cid) {
        await admin.from("pursuits").update({ company_id: cid }).eq("id", p.id);
        pursuitLinked++;
      }
    }

    // Link commitments → company_id + person_id
    for (const c of commitments ?? []) {
      const updates: Record<string, string> = {};
      if (c.company?.trim()) {
        const cid = findCompany(c.company);
        if (cid) updates.company_id = cid;
      }
      if (c.counterpart?.trim() && !/^the\s/i.test(c.counterpart.trim())) {
        const pid = findPerson(c.counterpart);
        if (pid) updates.person_id = pid;
      }
      if (Object.keys(updates).length > 0) {
        await admin.from("commitments").update(updates).eq("id", c.id);
        commitmentLinked++;
      }
    }

    // Link items → company_id
    for (const item of items ?? []) {
      const cf = (item.custom_fields ?? {}) as Record<string, unknown>;
      const co = cf.company as string | undefined;
      if (co?.trim()) {
        const cid = findCompany(co);
        if (cid) {
          await admin.from("items").update({ company_id: cid }).eq("id", item.id);
          itemLinked++;
        }
      }
    }

    // Link meetings → meeting_attendees junction
    for (const m of meetings ?? []) {
      const attendees: string[] = m.attendees ?? [];
      if (attendees.length === 0) continue;

      const personIds: string[] = [];
      for (const a of attendees) {
        const pid = findPerson(a);
        if (pid && pid !== "pending") personIds.push(pid);
      }

      if (personIds.length > 0) {
        const rows = [...new Set(personIds)].map((pid) => ({
          meeting_id: m.id,
          person_id: pid,
        }));
        await admin.from("meeting_attendees").upsert(rows, {
          onConflict: "meeting_id,person_id",
          ignoreDuplicates: true,
        });
        meetingLinked++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        stats: {
          unique_company_names: uniqueCompanies.size,
          unique_person_raws: personRaws.size,
          companies_in_db: companyMap.size,
          people_in_db: personByName.size,
          new_companies: newPeople.length > 0 ? "batch inserted" : 0,
          new_people: newPeople.length,
          pursuits_linked: pursuitLinked,
          commitments_linked: commitmentLinked,
          items_linked: itemLinked,
          meetings_linked: meetingLinked,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[backfill-identities] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
