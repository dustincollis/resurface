# Pressure Test Prompt for Resurface

> Paste this prompt into another AI system along with the attached `system-overview.md` document.

---

## Context

I'm building a personal AI-powered task and relationship management system called **Resurface**. The attached document (`system-overview.md`) is a comprehensive 900-line technical reference covering the entire system as it exists today — every table, every edge function, every design decision.

I'm the sole user right now: a sales/account executive managing 5-10 meetings per day across multiple parallel client pursuits (S&P, Adobe, Cvent, Chanel, Siteimprove, etc). The core problem is that things slip when sales work takes over — soft commitments get forgotten, follow-ups drift, context gets lost between meetings, and I can't tell what's actually progressing vs what's quietly dying.

The system has been built over two intense days of development. It works end-to-end: Jamie (meetjamie.ai) records my meetings → webhook fires → transcript is parsed by Claude Sonnet into structured proposals → I triage proposals (accept as task, commitment, or tracked item, assign to a pursuit) → items accumulate context via per-item AI chat → commitments track what I owe and what's owed to me → pursuits group threads of focus so they don't fade.

## What I want from you

I have three specific asks. Take them in order.

### Ask 1: Architecture critique

Read the system-overview.md document thoroughly. Then tell me:

- **What's over-engineered?** Where did I build abstractions I don't need yet? What would you simplify?
- **What's under-engineered?** Where are there structural weaknesses that will bite me as data accumulates? What's missing from the data model that I'll wish I had in 3 months?
- **What's fragile?** Which parts of the system depend on assumptions that could break? (e.g., undocumented APIs, single-user design, no test coverage, prompt stability)
- **What's the biggest architectural risk** if I wanted to add a second user? A tenth user? A hundred?

Be specific. Reference actual table names, function names, and design decisions from the document. Don't give generic advice — critique THIS system.

### Ask 2: What should I build next?

Given what exists and the data I'm starting to accumulate, what are the highest-leverage features I should build next? I'm not asking about the features I've already deferred (those are listed in Section 13 of the document). I'm asking: **what am I NOT thinking about?**

Specifically:

- **What analyses become possible** once I have 30 days of meeting transcripts, 100+ resolved proposals, 50+ completed items, and 20+ closed pursuits?
- **What would a "second brain" for a sales professional actually look like** if you had the substrate I've built? Not a to-do list with AI bolted on — something that genuinely changes how I work.
- **What exists in the world** (academic research, niche products, bleeding-edge AI capabilities) that could be applied to the data I'm collecting? Things I might not know about because I don't live in that world.

Two specific features I'm currently thinking about but haven't built:

1. **Pursuit templates / playbooks**: repeatable process maps that get stamped onto new pursuits. "Every new client deal needs these 12 steps." Different pursuit types get different templates. My question: is this just a checklist feature, or is there something deeper here?

2. **Goals**: strategic objectives that sit ABOVE pursuits and span quarters/years. "Build a GTM practice." "Execute QBRs quarterly." Different from pursuits (which are deal-specific and have won/lost outcomes). My question: how should goals relate to pursuits, and what data model makes this not just "another list of things"?

For both: what would make these genuinely AI-native rather than just digital checklists?

### Ask 3: The weird stuff

I have access to significant compute. I want to explore unconventional uses of the data I'm collecting. Things that might not be "features" in the traditional sense but could change how I understand my work.

- **What patterns could be extracted** from meeting transcripts that I'd never notice manually? (relationship dynamics, communication patterns, topic evolution, decision velocity, etc.)
- **What would a predictive layer look like** sitting on top of this data? Not "predict the stock market" — but "predict which pursuit is about to stall" or "predict which commitment will be broken" or "predict what topic will dominate next week's meetings."
- **What's the most unconventional thing** you could imagine building on this substrate? Something I'd never think to ask for because I don't know it's possible. Break out of the productivity-tool mental model entirely.

Don't self-censor. I'd rather hear 10 wild ideas where 2 are brilliant than 3 safe ideas that are all obvious.

## Constraints to keep in mind

- This is a personal tool, not a SaaS (yet). Over-engineering for multi-tenancy is premature.
- AI cost is ~$0.50-1.00/day. I'm not trying to minimize calls — I'm trying to maximize intelligence per dollar.
- The data is thin right now (2 weeks of meetings, ~50 items, ~10 pursuits). Some analyses need months of history. Tell me which ones, and what I should be collecting NOW to enable them later.
- I'm a sales professional, not a data scientist. Explain things in terms of what they DO, not how they work mathematically.
- The tech stack is React 19 + Supabase + Claude Sonnet. Suggest things that fit this stack or that are worth adding a new dependency for.

## Tone

Be direct. Don't pad with caveats or disclaimers. If something I built is dumb, say so and say why. If something is smart, say so briefly and move on. I want density of insight, not volume of text.

---

*Attach: system-overview.md*
