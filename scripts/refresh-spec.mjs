#!/usr/bin/env node

/**
 * refresh-spec.mjs
 *
 * Validates and updates AUTO-fenced sections of docs/SPEC.md from the filesystem.
 *
 * For SIMPLE sections (components, hooks, tables): merges new/removed entries
 * while preserving existing Purpose descriptions.
 *
 * For COMPLEX sections (routes, edge_functions): reports count mismatches
 * and new/removed entries without rewriting (these have custom formatting
 * that needs hand-curation).
 *
 * Usage: node scripts/refresh-spec.mjs [--check]
 *   --check   Don't write; exit 1 if the spec is out of date (CI-friendly)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SPEC_PATH = join(ROOT, 'docs', 'SPEC.md');
const CHECK_MODE = process.argv.includes('--check');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listFiles(dir, ext) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => ext ? e.name.endsWith(ext) : e.isDirectory())
      .map(e => e.name.replace(ext || '', ''))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  } catch {
    return [];
  }
}

/** Parse a simple 2-column markdown table, returning Map<col1, col2>. */
function parseTable(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.includes('---')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const key = cells[0].replace(/`/g, '').trim();
    // Skip header rows
    if (['Component', 'Hook', 'Table', 'Route', 'Function', 'Directory'].includes(key)) continue;
    map.set(key, cells.slice(1).join(' | '));
  }
  return map;
}

async function getRouteComponents() {
  const appPath = join(ROOT, 'src', 'App.tsx');
  const content = await readFile(appPath, 'utf-8');
  const components = new Set();
  const re = /element=\{<(\w+)/g;
  let m;
  while ((m = re.exec(content)) !== null) components.add(m[1]);
  return components;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let spec = await readFile(SPEC_PATH, 'utf-8');
  let changed = false;
  let warnings = [];

  function getSection(name) {
    const openTag = `<!-- AUTO:${name} -->`;
    const closeTag = `<!-- /AUTO:${name} -->`;
    const openIdx = spec.indexOf(openTag);
    const closeIdx = spec.indexOf(closeTag);
    if (openIdx === -1 || closeIdx === -1) return null;
    return { openTag, closeTag, openIdx, closeIdx, content: spec.slice(openIdx + openTag.length, closeIdx) };
  }

  function replaceSection(name, newContent) {
    const s = getSection(name);
    if (!s) { console.warn(`Warning: AUTO:${name} fences not found`); return; }
    const newSection = '\n' + newContent + '\n';
    if (s.content !== newSection) {
      changed = true;
      spec = spec.slice(0, s.openIdx + s.openTag.length) + newSection + spec.slice(s.closeIdx);
      console.log(`Updated: AUTO:${name}`);
    } else {
      console.log(`Up to date: AUTO:${name}`);
    }
  }

  // ── Routes: report-only ──
  {
    const pages = await listFiles(join(ROOT, 'src', 'pages'), '.tsx');
    const s = getSection('routes');
    if (s) {
      const existing = parseTable(s.content);
      const pageSet = new Set(pages);
      const specPages = new Set();
      for (const [, rest] of existing) {
        const page = rest.split('|')[0]?.trim();
        if (page) specPages.add(page);
      }
      const missing = pages.filter(p => !specPages.has(p));
      const removed = [...specPages].filter(p => !pageSet.has(p));
      if (missing.length) warnings.push(`Routes: new pages not in spec: ${missing.join(', ')}`);
      if (removed.length) warnings.push(`Routes: spec lists pages no longer on disk: ${removed.join(', ')}`);
      if (!missing.length && !removed.length) console.log('Up to date: AUTO:routes');
    }
  }

  // ── Components: merge-rewrite ──
  {
    const files = await listFiles(join(ROOT, 'src', 'components'), '.tsx');
    const s = getSection('components');
    const existing = s ? parseTable(s.content) : new Map();
    const lines = [
      `## 12. Components (${files.length})`, '',
      '| Component | Purpose |',
      '|-----------|---------|',
    ];
    for (const f of files) {
      const purpose = existing.get(f) || '';
      lines.push(`| ${f} | ${purpose} |`);
    }
    replaceSection('components', lines.join('\n'));
  }

  // ── Hooks: merge-rewrite ──
  {
    const files = await listFiles(join(ROOT, 'src', 'hooks'), '.ts');
    const s = getSection('hooks');
    const existing = s ? parseTable(s.content) : new Map();
    const lines = [
      `## 13. Hooks (${files.length})`, '',
      '| Hook | Purpose |',
      '|------|---------|',
    ];
    for (const f of files) {
      const purpose = existing.get(f) || '';
      lines.push(`| ${f} | ${purpose} |`);
    }
    replaceSection('hooks', lines.join('\n'));
  }

  // ── Edge Functions: report-only ──
  {
    const dirs = await listFiles(join(ROOT, 'supabase', 'functions'), null);
    const fns = dirs.filter(d => d !== '_shared');
    const s = getSection('edge_functions');
    if (s) {
      const existing = parseTable(s.content);
      const fnSet = new Set(fns);
      const specFns = new Set([...existing.keys()].filter(k => k !== '_shared'));
      const missing = fns.filter(f => !specFns.has(f));
      const removed = [...specFns].filter(f => !fnSet.has(f));
      if (missing.length) warnings.push(`Edge Functions: new functions not in spec: ${missing.join(', ')}`);
      if (removed.length) warnings.push(`Edge Functions: spec lists functions no longer on disk: ${removed.join(', ')}`);
      if (!missing.length && !removed.length) console.log(`Up to date: AUTO:edge_functions (${fns.length} functions)`);
    }
  }

  // ── Tables: merge-rewrite ──
  {
    const migrationDir = join(ROOT, 'supabase', 'migrations');
    const files = await listFiles(migrationDir, '.sql');
    const tableSource = {};
    for (const f of files) {
      const content = await readFile(join(migrationDir, f + '.sql'), 'utf-8');
      const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi;
      let m;
      while ((m = re.exec(content)) !== null) {
        if (!tableSource[m[1]]) tableSource[m[1]] = f;
      }
    }
    const sorted = Object.keys(tableSource).sort();
    const lines = [
      `## 15. Database Tables (${files.length} migrations, ${sorted.length} tables)`, '',
      '| Table | Source migration |',
      '|-------|-----------------|',
    ];
    for (const t of sorted) {
      lines.push(`| ${t} | ${tableSource[t]} |`);
    }
    replaceSection('tables', lines.join('\n'));
  }

  // ── Write + report ──
  if (warnings.length) {
    console.log('\n⚠ Manual updates needed (these sections have custom formatting):');
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (changed) {
    if (CHECK_MODE) {
      console.error('\nSPEC.md is out of date. Run: node scripts/refresh-spec.mjs');
      process.exit(1);
    }
    await writeFile(SPEC_PATH, spec);
    console.log('\nSPEC.md updated.');
  } else if (!warnings.length) {
    console.log('\nSPEC.md is in sync.');
  }

  if (CHECK_MODE && warnings.length) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
