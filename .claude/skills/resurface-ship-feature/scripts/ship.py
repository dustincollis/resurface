#!/usr/bin/env python3
"""
Ship a Resurface change end-to-end.

Default mode (no flag) runs pre-flight checks read-only and prints an action
plan. With --ship, executes the plan in the right order: supabase db push for
migrations, npm run deploy:functions for changed edge functions, git push for
frontend (Vercel auto-deploys).

The skill exists because "deploy" in Resurface means more than one thing —
DB, edge functions, and frontend each ship through different pipes. Doing
them in the wrong order, or forgetting one, has bit Dustin before.
"""

import argparse
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path("/Users/dustincollis/resurface")

# ANSI colors for clarity in terminal output
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
RESET = "\033[0m"
DIM = "\033[2m"


def ok(msg):
    print(f"{GREEN}✓{RESET} {msg}")


def warn(msg):
    print(f"{YELLOW}⚠{RESET}  {msg}")


def fail(msg):
    print(f"{RED}✗{RESET} {msg}")


def section(title):
    print(f"\n{BOLD}━━━ {title} ━━━{RESET}")


def run(cmd, cwd=None, capture=True):
    """Run a shell command. Returns (returncode, stdout, stderr)."""
    result = subprocess.run(
        cmd,
        cwd=cwd or str(PROJECT_ROOT),
        capture_output=capture,
        text=True,
    )
    return result.returncode, result.stdout, result.stderr


# ----------------------------------------------------------------------------
# Pre-flight checks
# ----------------------------------------------------------------------------

def check_working_tree_clean():
    """No uncommitted changes. Committing is a thinking activity, not the
    skill's job."""
    rc, out, _ = run(["git", "status", "--porcelain"])
    if rc != 0:
        fail("git status failed")
        return False
    if out.strip():
        fail("Working tree has uncommitted changes:")
        for line in out.strip().split("\n")[:10]:
            print(f"    {line}")
        print("\n  Commit first, then re-run.")
        return False
    ok("Working tree clean")
    return True


def check_build():
    print(f"  {DIM}Running npm run build (this takes ~5s)...{RESET}")
    t0 = time.time()
    rc, out, err = run(["npm", "run", "build"])
    elapsed = time.time() - t0
    if rc != 0:
        fail(f"Build FAILED in {elapsed:.1f}s")
        print(err[-1500:] if err else out[-1500:])
        return False
    ok(f"Build passes ({elapsed:.1f}s)")
    return True


def check_changelog_dated_today():
    """SPEC.md must have a changelog bullet dated today. Easy to forget."""
    spec = PROJECT_ROOT / "docs" / "SPEC.md"
    if not spec.exists():
        warn("docs/SPEC.md not found — skipping changelog check")
        return True
    today = date.today().isoformat()
    text = spec.read_text()
    pattern = rf"^- \*\*{re.escape(today)}\*\*"
    if re.search(pattern, text, re.MULTILINE):
        ok(f"SPEC.md changelog has entry dated {today}")
        return True
    fail(f"SPEC.md changelog missing entry for {today}")
    print("  Add a bullet under '## Changelog' describing this ship.")
    return False


def check_auto_sections_in_sync():
    """The refresh-spec script regenerates AUTO sections (routes, components,
    hooks, edge functions). If running it produces a diff, the spec is stale."""
    refresh = PROJECT_ROOT / "scripts" / "refresh-spec.mjs"
    if not refresh.exists():
        warn("scripts/refresh-spec.mjs not found — skipping AUTO check")
        return True
    rc, _, _ = run(["node", "scripts/refresh-spec.mjs"])
    if rc != 0:
        warn("refresh-spec.mjs failed — skipping AUTO check")
        return True
    rc, out, _ = run(["git", "status", "--porcelain", "docs/SPEC.md"])
    if out.strip():
        fail("AUTO sections in SPEC.md are out of date.")
        print("  Run: node scripts/refresh-spec.mjs && git add docs/SPEC.md && git commit --amend --no-edit")
        # Restore SPEC.md so the working tree is the same after the check.
        run(["git", "checkout", "--", "docs/SPEC.md"])
        return False
    ok("AUTO sections in sync")
    return True


# ----------------------------------------------------------------------------
# Diff analysis: what's about to ship
# ----------------------------------------------------------------------------

def fetch_origin():
    rc, _, err = run(["git", "fetch", "origin", "main"])
    if rc != 0:
        warn(f"git fetch failed: {err.strip()[:200]}")


def diff_files_vs_main():
    """Files changed in commits ahead of origin/main. Empty list if nothing
    is ahead."""
    rc, out, _ = run(["git", "diff", "--name-only", "origin/main..HEAD"])
    if rc != 0:
        return []
    return [line for line in out.strip().split("\n") if line]


def commits_ahead():
    rc, out, _ = run(["git", "rev-list", "--count", "origin/main..HEAD"])
    if rc != 0:
        return 0
    try:
        return int(out.strip())
    except ValueError:
        return 0


def categorize_changes(files):
    """Bucket files by what kind of deploy they need."""
    cats = {
        "migrations": [],
        "edge_functions": set(),  # function names (dir names under supabase/functions/)
        "frontend": [],
        "mcp_server": [],
        "spec": [],
        "config": [],
    }
    for f in files:
        if f.startswith("supabase/migrations/"):
            cats["migrations"].append(f)
        elif f.startswith("supabase/functions/"):
            # Extract the function name (the dir under supabase/functions/)
            m = re.match(r"supabase/functions/([^/]+)/", f)
            if m and m.group(1) != "_shared":
                cats["edge_functions"].add(m.group(1))
            elif m and m.group(1) == "_shared":
                # Shared file — affects ALL functions. Don't auto-deploy them
                # all (too risky); flag for the user.
                cats.setdefault("shared_function_code", []).append(f)
        elif f.startswith("mcp-server/"):
            cats["mcp_server"].append(f)
        elif f.startswith("src/") or f.startswith("public/") or f.startswith("index.html"):
            cats["frontend"].append(f)
        elif f.startswith("docs/SPEC.md"):
            cats["spec"].append(f)
        elif f in {"package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "tailwind.config.ts"}:
            cats["config"].append(f)
        else:
            cats.setdefault("other", []).append(f)
    cats["edge_functions"] = sorted(cats["edge_functions"])
    return cats


def describe_changes(cats, ahead):
    section(f"Diff vs origin/main ({ahead} commits ahead)")
    if cats["migrations"]:
        names = ", ".join(Path(f).name for f in cats["migrations"])
        print(f"  migrations:     {len(cats['migrations'])} new ({names})")
    if cats["edge_functions"]:
        print(f"  edge functions: {', '.join(cats['edge_functions'])}")
    if cats.get("shared_function_code"):
        warn(f"  _shared/ code changed ({len(cats['shared_function_code'])} file(s)) — affects all functions; consider redeploying any that use the changed module")
    if cats["mcp_server"]:
        print(f"  mcp server:     {len(cats['mcp_server'])} file(s) changed (manual rebuild needed: cd mcp-server && npm run build, then user restarts MCP host)")
    if cats["frontend"]:
        print(f"  frontend:       {len(cats['frontend'])} file(s) (auto-deploys via Vercel on push)")
    if cats["spec"]:
        print(f"  spec:           {len(cats['spec'])} change(s) to docs/SPEC.md")
    if cats["config"]:
        print(f"  config:         {', '.join(cats['config'])}")
    other = cats.get("other", [])
    if other:
        print(f"  other:          {len(other)} file(s)")
        for f in other[:5]:
            print(f"                  - {f}")
        if len(other) > 5:
            print(f"                  ... and {len(other) - 5} more")


# ----------------------------------------------------------------------------
# Required skill invocations (per CLAUDE.md)
# ----------------------------------------------------------------------------

CLAUDE_API_PATHS = [
    "supabase/functions/",  # any edge function may call Anthropic
]
SECURITY_REVIEW_PATHS = [
    "supabase/functions/",
    "supabase/migrations/",
    "src/lib/supabase.ts",
    "mcp-server/",
]


def required_skills(files):
    needs_claude_api = any(
        any(f.startswith(p) for p in CLAUDE_API_PATHS) for f in files
    )
    needs_security_review = any(
        any(f.startswith(p) for p in SECURITY_REVIEW_PATHS) for f in files
    )
    return needs_claude_api, needs_security_review


def describe_skill_invocations(needs_claude_api, needs_security_review, files):
    if not (needs_claude_api or needs_security_review):
        return
    section("Required skill invocations (per CLAUDE.md)")
    if needs_claude_api:
        functions_changed = sorted(
            {
                m.group(1)
                for m in (re.match(r"supabase/functions/([^/]+)/", f) for f in files)
                if m and m.group(1) != "_shared"
            }
        )
        target = ", ".join(functions_changed) if functions_changed else "edge functions"
        warn(f"claude-api      — invoke before push (changed: {target})")
    if needs_security_review:
        warn("security-review — invoke on the diff before push (auth/RLS/PII paths touched)")


# ----------------------------------------------------------------------------
# Ship actions
# ----------------------------------------------------------------------------

def ship_migrations():
    print(f"\n{BOLD}→ supabase db push{RESET}")
    rc, out, err = run(["supabase", "db", "push"], capture=False)
    if rc != 0:
        fail("supabase db push failed")
        return False
    return True


def ship_edge_functions(function_names):
    print(f"\n{BOLD}→ npm run deploy:functions -- {' '.join(function_names)}{RESET}")
    rc, out, err = run(
        ["npm", "run", "deploy:functions", "--", *function_names],
        capture=False,
    )
    if rc != 0:
        fail("npm run deploy:functions failed")
        return False
    return True


def ship_git_push():
    print(f"\n{BOLD}→ git push origin main{RESET}")
    rc, out, err = run(["git", "push", "origin", "main"], capture=False)
    if rc != 0:
        fail("git push failed")
        print("  WARNING: DB and edge functions may have already shipped above.")
        print("  Resolve the push manually (likely a fast-forward issue or hook failure).")
        return False
    return True


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--ship",
        action="store_true",
        help="Execute the deploy actions after pre-flight passes. Default is check-only.",
    )
    p.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip the npm run build check (for fast iteration; not recommended for actual ships).",
    )
    args = p.parse_args()

    os.chdir(str(PROJECT_ROOT))

    # ---- Pre-flight ----
    section("Pre-flight")
    preflight_ok = True
    if not check_working_tree_clean():
        preflight_ok = False
    if not args.skip_build:
        if not check_build():
            preflight_ok = False
    else:
        warn("Skipping build check (--skip-build)")
    if not check_changelog_dated_today():
        preflight_ok = False
    if not check_auto_sections_in_sync():
        preflight_ok = False

    # ---- Diff analysis ----
    fetch_origin()
    files = diff_files_vs_main()
    ahead = commits_ahead()

    if ahead == 0 and not files:
        section("Nothing to ship")
        print("  Local main matches origin/main. Make a commit first.")
        return 0 if preflight_ok else 1

    cats = categorize_changes(files)
    describe_changes(cats, ahead)

    # ---- Skill invocations ----
    needs_claude_api, needs_security_review = required_skills(files)
    describe_skill_invocations(needs_claude_api, needs_security_review, files)

    # ---- Action plan ----
    section("Action plan")
    actions = []
    if cats["migrations"]:
        actions.append(("supabase db push", f"{len(cats['migrations'])} migration(s)"))
    if cats["edge_functions"]:
        actions.append(
            (
                f"npm run deploy:functions -- {' '.join(cats['edge_functions'])}",
                f"{len(cats['edge_functions'])} function(s)",
            )
        )
    if files:
        actions.append(("git push origin main", "frontend → Vercel"))

    if not actions:
        print("  Nothing to do.")
        return 0 if preflight_ok else 1

    for i, (cmd, note) in enumerate(actions, 1):
        print(f"  {i}. {cmd:60s}{DIM}({note}){RESET}")

    if not args.ship:
        print(f"\n{DIM}Run with --ship to execute. Invoke any warned skills first.{RESET}")
        return 0 if preflight_ok else 1

    # ---- Execute ----
    if not preflight_ok:
        print(f"\n{RED}Pre-flight failed. Fix the issues above and re-run.{RESET}")
        return 1

    if needs_claude_api or needs_security_review:
        warn(
            "Required skills (claude-api / security-review) listed above. "
            "Did you invoke them? If not, exit and do so before re-running with --ship."
        )
        try:
            answer = input("Continue anyway? [y/N] ").strip().lower()
        except EOFError:
            answer = "n"
        if answer != "y":
            return 1

    section("Shipping")

    if cats["migrations"] and not ship_migrations():
        return 1
    if cats["edge_functions"] and not ship_edge_functions(cats["edge_functions"]):
        return 1
    if files and not ship_git_push():
        return 1

    section("Done")
    ok("All ship steps completed.")
    print(f"  {DIM}Vercel will rebuild the frontend within ~1 minute.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
