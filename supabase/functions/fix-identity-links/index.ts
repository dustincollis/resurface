// fix-identity-links: one-time fix to:
// 1. Set domains on companies by extracting from people's emails
// 2. Link people to companies by email domain
// 3. Auto-merge duplicate people (email version + voice-name version)
//    by matching within the same meeting's attendees

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.102.1";
import { corsHeaders } from "../_shared/cors.ts";

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  return at > 0 ? email.substring(at + 1).toLowerCase() : null;
}

function emailToDisplayName(email: string): string {
  const local = email.split("@")[0];
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/** Extract first name from a display name */
function firstName(name: string): string {
  return name.split(/\s+/)[0].toLowerCase();
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
    const userId = Deno.env.get("RESURFACE_DEFAULT_USER_ID")!;

    const stats = {
      companies_domain_set: 0,
      people_linked_to_company: 0,
      people_merged: 0,
      merge_details: [] as string[],
    };

    // ============================================================
    // Step 1: Extract domains from people's emails → set on companies
    // ============================================================

    const { data: allPeople } = await admin
      .from("people")
      .select("id, name, email, company_id, aliases")
      .eq("user_id", userId);

    const { data: allCompanies } = await admin
      .from("companies")
      .select("id, name, domain, aliases")
      .eq("user_id", userId);

    // Build domain → company map from known company names
    // Common patterns: "EPAM" → epam.com, "Adobe" → adobe.com
    const companyByName = new Map<string, { id: string; name: string; domain: string | null }>();
    for (const c of allCompanies ?? []) {
      companyByName.set(c.name.toLowerCase(), c);
    }

    // Collect all email domains from people
    const domainToPeople = new Map<string, typeof allPeople>();
    for (const p of allPeople ?? []) {
      if (p.email && isEmail(p.email)) {
        const domain = emailDomain(p.email);
        if (domain) {
          if (!domainToPeople.has(domain)) domainToPeople.set(domain, []);
          domainToPeople.get(domain)!.push(p);
        }
      }
    }

    // For each domain with multiple people, try to find/create a company
    for (const [domain, people] of domainToPeople) {
      // Skip common personal email domains
      if (["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com"].includes(domain)) continue;

      // Check if a company already has this domain
      let companyId: string | null = null;
      for (const c of allCompanies ?? []) {
        if (c.domain?.toLowerCase() === domain) {
          companyId = c.id;
          break;
        }
      }

      // Try matching domain to company name
      if (!companyId) {
        const domainRoot = domain.split(".")[0].toLowerCase(); // "epam.com" → "epam"
        for (const c of allCompanies ?? []) {
          if (c.name.toLowerCase() === domainRoot || c.name.toLowerCase().startsWith(domainRoot)) {
            companyId = c.id;
            // Set the domain on the company
            await admin.from("companies").update({ domain }).eq("id", c.id);
            stats.companies_domain_set++;
            break;
          }
        }
      }

      // If still no company, create one from the domain
      if (!companyId && people.length >= 2) {
        const domainRoot = domain.split(".")[0];
        const companyName = domainRoot.charAt(0).toUpperCase() + domainRoot.slice(1);
        const { data: newCo } = await admin
          .from("companies")
          .insert({ user_id: userId, name: companyName, domain })
          .select("id")
          .single();
        if (newCo) {
          companyId = newCo.id;
          stats.companies_domain_set++;
        }
      }

      // Link people to company
      if (companyId) {
        for (const p of people) {
          if (!p.company_id) {
            await admin.from("people").update({ company_id: companyId }).eq("id", p.id);
            stats.people_linked_to_company++;
          }
        }
      }
    }

    // ============================================================
    // Step 2: Merge duplicate people (email vs voice name)
    // ============================================================
    // Strategy: for each person with an email, check if there's another
    // person whose name matches the email's first name, and who shares
    // at least one meeting via meeting_attendees.

    // Re-fetch people after domain linking
    const { data: refreshedPeople } = await admin
      .from("people")
      .select("id, name, email, company_id, aliases")
      .eq("user_id", userId);

    // Build a map of first-name → people (for voice-name people without email)
    const voiceNamePeople = (refreshedPeople ?? []).filter((p) => !p.email || !isEmail(p.email ?? ""));
    const emailPeople = (refreshedPeople ?? []).filter((p) => p.email && isEmail(p.email));

    // Get all meeting_attendees for matching
    const { data: allAttendees } = await admin
      .from("meeting_attendees")
      .select("meeting_id, person_id");

    // Build person → meetings map
    const personMeetings = new Map<string, Set<string>>();
    for (const a of allAttendees ?? []) {
      if (!personMeetings.has(a.person_id)) personMeetings.set(a.person_id, new Set());
      personMeetings.get(a.person_id)!.add(a.meeting_id);
    }

    // For each email person, find potential voice-name matches
    const merged = new Set<string>(); // IDs that have been merged away
    for (const emailPerson of emailPeople) {
      if (merged.has(emailPerson.id)) continue;
      const emailFirstName = firstName(emailToDisplayName(emailPerson.email!));
      const emailMeetings = personMeetings.get(emailPerson.id) ?? new Set();

      for (const voicePerson of voiceNamePeople) {
        if (merged.has(voicePerson.id)) continue;
        if (voicePerson.id === emailPerson.id) continue;

        const voiceFirstNameStr = firstName(voicePerson.name);

        // Check if first names match
        if (emailFirstName !== voiceFirstNameStr) continue;

        // Check if they share at least one meeting
        const voiceMeetings = personMeetings.get(voicePerson.id) ?? new Set();
        let sharedMeeting = false;
        for (const mid of emailMeetings) {
          if (voiceMeetings.has(mid)) {
            sharedMeeting = true;
            break;
          }
        }

        if (!sharedMeeting && voiceMeetings.size > 0 && emailMeetings.size > 0) continue;

        // Merge: keep email person (has more data), absorb voice person
        // Add voice name as alias
        const existingAliases: string[] = emailPerson.aliases ?? [];
        if (!existingAliases.includes(voicePerson.name.toLowerCase())) {
          existingAliases.push(voicePerson.name.toLowerCase());
        }
        await admin.from("people").update({ aliases: existingAliases }).eq("id", emailPerson.id);

        // Move meeting_attendees from voice → email
        await admin
          .from("meeting_attendees")
          .update({ person_id: emailPerson.id })
          .eq("person_id", voicePerson.id);

        // Move commitments from voice → email
        await admin
          .from("commitments")
          .update({ person_id: emailPerson.id })
          .eq("person_id", voicePerson.id);

        // Delete voice person
        await admin.from("people").delete().eq("id", voicePerson.id);

        merged.add(voicePerson.id);
        stats.people_merged++;
        stats.merge_details.push(`"${voicePerson.name}" → "${emailPerson.name}" (${emailPerson.email})`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[fix-identity-links] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
