# Handoff prompt

Paste the block below into a fresh session. It is deliberately short: it points at the
docs rather than repeating them, which is the whole reason the docs exist.

Update the **"Right now"** line before pasting, so the new session starts on the right
thing instead of asking.

---

```
Working directory: C:\Users\temot\BetaReal-Engine

Read HANDOFF.md first — the STATE block at the top is current as of 2026-09-11.
Then AUDIT.md (defects and the checks that catch each class) and CUSTOMER.md
(what the product is like to use, and what still blocks self-serve). Those three
carry everything; do not ask me to re-explain what is in them.

Standing rules:
- Niko's repo at "C:\Users\temot\BetaReal scaleable" is READ-ONLY. Copy from it,
  never modify it.
- NEVER print secrets. .env holds the Meshy key, R2 keys, STUDIO_USERS,
  MESHY_WEBHOOK_SECRET, Supabase keys. Report them masked. This has gone wrong
  before and cost a rotation.
- A generation costs 30 CREDITS and about 50 dishes remain. Never spend one
  without asking me first.
- Priority is speed AND quality. I will not sacrifice either.
- Do not stray from the priorities I set.
- No <speak> blocks unless my message starts with [voice].
- Commit and push finished work without asking. Deploys are reversible.
- Check the effect, never the input: a check that reads back what your own code
  just wrote is an echo, not a test. Prove a new check can go red.

Before you finish anything, run the suites: check_admin (needs both dev servers),
check_features, check_render, check_jobs, check_schema, check_publish, and
`npm test` in admin/. Counts are in HANDOFF.md; they should not go down.

Right now: <<< REPLACE THIS with the one thing you want done >>>
```

---

## Suggested "Right now" lines

Pick whichever is true when you paste it.

**The menu importer** — needs `ANTHROPIC_API_KEY` in `.env` and photos of Corner's menu:

```
Right now: I have added ANTHROPIC_API_KEY to .env and put photos of Corner at
Tabidze's paper menu in <FOLDER>. Build the menu importer: one drop zone, any
file type, a model reads it, and I get a review grid I can fix before importing.
No configuration steps — see CUSTOMER.md and the zero-config rule. Print the
exact token usage and cost of the first real run so I can decide on the model.
```

**The mobile pass** — needs nothing from me:

```
Right now: make the admin much better on a phone. That is where owners actually
use it. Go screen by screen, and show me what you changed and why.
```

**The browser check** — the one gap in "does the 3D actually work":

```
Right now: start both dev servers and drive the admin with Chrome. Confirm the
things built on 2026-09-09/11 actually render and behave: drag-and-drop upload,
the capture guide, the sizes and extras editor, the sold-out toggle, and the
print sheet. Then confirm a 3D dish really renders in the viewer on a live menu.
```
