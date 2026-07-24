// Canonical, audience-neutral copy for each policy: what it is, and why a minister reaches
// for it. This is reference DATA, not presentation — it is the same sentence for every seat,
// every platform, forever, so it lives beside the engine as one source of truth that the CLI
// game, the headless sim's verbose/epilogue output, and any future UI all import.
//
// Contextual framing that depends on WHO is looking (doctrine discounts, "cheap for you",
// tier comparisons, localisation, tone) is a presentation concern and stays in the UI layer.
// If a string would read differently for a different seat or platform, it does not belong here.

export type PolicyCopy = {
  summary: string     // what the policy is, in one plain line
  rationale: string   // why / when a minister would use it, and the catch
}

export const POLICY_COPY: Record<string, PolicyCopy> = {
  // ---- Energy ----
  'coal-phaseout': {
    summary: 'Retire coal generation on a fixed schedule.',
    rationale: 'A deep, durable emissions cut — but it raises power prices and strands jobs, so it burns the seat that enacts it.',
  },
  'renewables-grid': {
    summary: 'Build out wind, solar and the grid to carry them.',
    rationale: 'The structural fix that decides the ending, but it lands slowly (long lag) and pays almost no political credit when it finally arrives.',
  },
  'fossil-subsidy-removal': {
    summary: 'Stop paying to keep fossil fuels artificially cheap.',
    rationale: 'A fast, cheap cut that also frees money — but ending cheap energy is felt at the pump immediately.',
  },
  'efficiency-retrofit': {
    summary: 'Insulate buildings and upgrade industry to waste less energy.',
    rationale: 'A quiet, low-cost cut that also builds a little adaptation. Rarely controversial, rarely enough on its own.',
  },

  // ---- Agriculture & Land ----
  'methane-livestock': {
    summary: 'Cut methane from fossil leaks, landfill and livestock.',
    rationale: 'The largest fast-acting lever in the game — methane is short-lived, so cutting it bends temperature within a round or two. The aggressive tier means herd caps, which the countryside will not forgive.',
  },
  'deforestation-halt': {
    summary: 'Stop clearing forests for farmland and timber.',
    rationale: 'Protects a carbon sink and biodiversity at once, and can be locked in permanently — but it removes rural livelihoods.',
  },
  'regen-soil': {
    summary: 'Shift farming to practices that store carbon in soil.',
    rationale: 'Cuts emissions and improves food resilience with little political pain — but it works slowly.',
  },
  'food-resilience': {
    summary: 'Harden the food system against shocks: stores, diversity, distribution.',
    rationale: 'Directly relieves food insecurity — the deadliest channel — and it is popular, so it also restores health. Does nothing for emissions.',
  },

  // ---- Treasury ----
  'carbon-price': {
    summary: 'Put a price on emitting carbon across the economy.',
    rationale: 'The heaviest economy-wide cut Treasury holds — but it raises consumer prices, spikes food insecurity before it pays off, and puts your name on every bill.',
  },
  'border-carbon': {
    summary: 'Tariff imports by their carbon content so clean domestic industry is not undercut.',
    rationale: 'Cuts emissions without hammering your own consumers the way a carbon price does — but it is an act of trade aggression that strains diplomacy and invites retaliation.',
  },
  'transition-dividend': {
    summary: 'Return revenue to households as a cash dividend or transition fund.',
    rationale: 'Buys political health back and eases food stress fast. It trades nothing for the planet, and that trade should feel bad every time.',
  },
  'adaptation-debt-relief': {
    summary: 'Forgive or restructure debt so exposed states can afford to adapt.',
    rationale: 'Builds resilience abroad and clears displacement cheaply, with little cost to you — but it spends internationally, which not everyone at home rewards.',
  },

  // ---- Foreign & Trade ----
  'coalition-deal': {
    summary: 'Strike an emissions deal with a non-member state.',
    rationale: 'Cuts emissions you have no domestic control over, and can be locked in — but it lands slowly and spends your limited standing abroad.',
  },
  'tech-transfer': {
    summary: 'Share clean technology with developing economies.',
    rationale: 'A large cut delivered through others, cheaply — but it is the slowest lever in the game, so start it early or not at all.',
  },
  'trade-carbon-measures': {
    summary: 'Use trade rules to penalise high-carbon goods.',
    rationale: 'A meaningful cut with diplomatic leverage — but it raises prices at home and abroad and hardens opponents.',
  },
  'climate-finance': {
    summary: 'Fund resettlement and adaptation for the displaced, internationally.',
    rationale: 'The most direct way to clear the unresettled — the people who die from not being resettled — but the money goes abroad, which erodes support at home.',
  },

  // ---- Environment ----
  'wetland-restoration': {
    summary: 'Restore wetlands and mangroves as carbon sinks and storm buffers.',
    rationale: 'A rare policy that stores carbon, shelters coasts, and builds resilience at once, and can be made permanent — its benefits just arrive late.',
  },
  'protected-areas': {
    summary: 'Place land and sea under legal protection.',
    rationale: 'Locks in biodiversity and forest gains beyond the reach of the next government — at the cost of the livelihoods that used that land.',
  },
  'ocean-coral': {
    summary: 'Intervene to slow reef and ocean collapse.',
    rationale: 'Defends fisheries and biodiversity, but it is slow and easily dismissed as scenery while people are dying elsewhere.',
  },

  // ---- Civil Resilience ----
  'flood-defence': {
    summary: 'Build flood defences and early-warning systems.',
    rationale: 'The "we should have built the defences" policy: accumulated flood defence is what blunts disaster deaths when the Events Deck turns. It does nothing until a shock comes.',
  },
  'heat-adaptation': {
    summary: 'Cooling, shade and heat plans for exposed populations.',
    rationale: 'The main thing standing between a wet-bulb event and mass death. It builds fast and cheaply — you just cannot adapt your way out of the worst heat entirely.',
  },
  'resettlement': {
    summary: 'Move and rehouse displaced populations before they are stranded.',
    rationale: 'Clears the unresettled stock — the driver of the displacement death channel — and is one of the few things that reduces a body count directly.',
  },
  'famine-relief': {
    summary: 'Emergency food aid to populations in crisis.',
    rationale: 'Fast, visible, and it cuts the food channel now — the most preventable deaths in the game. Buys health too. Does nothing for the long game.',
  },
}

export function policyCopy(id: string): PolicyCopy {
  return POLICY_COPY[id] ?? { summary: '', rationale: '' }
}
