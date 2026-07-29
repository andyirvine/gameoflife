# COPY.md — where every word lives

A map for editing the game's writing without hunting. **Most copy is plain strings you can
change freely.** A few places build sentences from variables — those are flagged ⚠.

## Preview loop

```bash
npm run dev        # → http://localhost:5180
```

Edit any file below and the browser hot-reloads. If you break a quote or a `` `${...}` ``,
Vite shows a red error overlay in the browser — nothing breaks silently, so it's safe to
experiment.

Note: the files under `src/engine/` are shared by **both** the browser game and the terminal
game (`npm run play`), so editing card flavour or policy text there updates both. That's
fine — it's the same writing.

---

## 1. The browser UI  (`src/ui/`)

| File | What's in it | Notes |
|---|---|---|
| `Intro.tsx` | The opening premise (the `briefing` view) and the entire **How to play** text (the `howto` view — the four beats and the "rules that matter" list). | ✅ plain prose |
| `Theatre.tsx` | The **framing** of each round beat: the stage titles & subtitles ("THE SITUATION", "The advisors table their assessment"), section headers ("AROUND THE CABINET —"), and the button labels ("THE WORLD MOVES ▸", "TAKE THE FLOOR ▸", "COMMIT & RESOLVE ▸"). | ✅ plain prose. The *content* of the diagnosis/advice comes from `session.ts` (see §3). |
| `Epilogue.tsx` | The end-of-game report: the verdict lines, the "ministry character" sentence, the reckoning paragraph, the forecast-reveal line, and the closing thesis ("You did not play to ensure survival…"). | ✅ mostly plain; a few `${...}` values ⚠ |
| `Dashboard.tsx` | The panel headings (PLANET, PLANETARY TARGETS, THE CABINET, YOUR FORECAST, IN FLIGHT, YOUR SEAT, THE LEDGER…) and small labels. | ✅ plain |

**Seat names & one-line weaknesses** ("Treasury — owns every downturn…") live in
`src/ui/session.ts`, in the `SEAT_NAME` and `SEAT_WEAKNESS` objects near the top.

---

## 2. Flavour & policy text  (`src/engine/` — plain data, safe to edit)

| File | What's in it | Search for |
|---|---|---|
| `policy-copy.ts` | Every policy's one-line **summary** and its **rationale** (the "why / and the catch"). 23 policies. | the `POLICY_COPY` object |
| `world-deck.ts` | The World Deck cards — each `name` and its satirical `flavor:` line (the free-riding petrostate, the summit that achieves nothing…). ~24 cards. | `flavor:` |
| `events-deck.ts` | The Events Deck cards — each `name` and `flavor:` line (Siberian methane release, wet-bulb event…). 15 cards. | `flavor:` |
| `forecast.ts` | The six forecast models' `name` and `creed:` (their worldview). | `creed:` |
| `targets.ts` | The nine target names and their goal strings ("≤ 18 GtCO₂e", "stabilised"…). | `name:` / `goal:` |

---

## 3. Generated / templated text  (⚠ edit with care — mind the `${...}`)

These assemble sentences from live game numbers. You can absolutely reword them — just keep
the `` `${...}` `` interpolations intact.

| File | What's in it | Where |
|---|---|---|
| `src/ui/session.ts` | The **advisors' diagnosis** and the **your-move advice** shown in the theatre. | `diagnosis()` and `advice()` methods |
| `src/engine/forecast.ts` | The forecast **headline** ("The harvest goes first: ~1454M food-insecure by 2048…"), one per emphasis. | `buildHeadline()` |
| `src/engine/ai.ts` | The AI ministers' **spoken declarations** — the refusal line, the commit line, the "sitting this out" line. | `refusalLine()`, `commitLine()`, `idleLine()`, `restrictionPhrase()` |

---

## 4. The terminal game  (`src/sim/` — only affects `npm run play`, not the browser)

Heads-up: the browser and terminal games have **separate** copy in a couple of places, so a
change in `src/ui/` does **not** change the terminal game, and vice-versa:

- **Epilogue** — browser: `src/ui/Epilogue.tsx` · terminal: `src/sim/epilogue.ts` + the
  reckoning/slope prose in `src/sim/play.ts` (`printReckoning`).
- **Seat names / weaknesses** — browser: `src/ui/session.ts` · terminal: `src/sim/play.ts`.
- Most other CLI narration (the round headers, the "THE TRADE" block, the forecast panel) is
  in `src/sim/play.ts`.

If you'd rather not maintain two copies, ask and I'll consolidate the shared narrative into
one module both read from.

---

## Voice

Satirical, but the satire points at the *system*, not the people — the ministers are trying;
the absurdity lives in the World Deck. The counter is honest and never softened (no
"lives saved", no comfort). If in doubt: specific, dry, and implicating.
