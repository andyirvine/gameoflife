import type { PlanetState, PortfolioId } from './types.ts'
import type { Rng } from './rng.ts'

// The World Deck. Responsive, political and economic. Draws are weighted by the state of the
// game, not a fixed schedule: if the coalition is fracturing the deck turns nastier; if the
// cabinet is stable and credible, opportunities appear. The world reacts to you.
//
// The satire lives here — the free-riding petrostate, the summit that achieves nothing, the
// tipping-point warning that turns out to be a modelling error and poisons the well for a
// decade. It points at the system, not the people.

export type WorldCard = {
  id: string
  name: string
  tone: 'hostile' | 'opportunity' | 'neutral'
  baseWeight: number
  // Effects the current engine can apply: political health by portfolio, a cabinet-wide
  // health delta, and economic cards that nudge the planet (industry relocating, a recession).
  healthDelta?: Partial<Record<PortfolioId, number>>
  cabinetHealthDelta?: number
  planetPulse?: Partial<PlanetState>
  flavor: string
}

export const WORLD_DECK: WorldCard[] = [
  // ---- Hostile (weight rises as the cabinet fractures) ----
  { id: 'petrostate-freerides', name: 'Petrostate free-rides', tone: 'hostile', baseWeight: 1.0,
    healthDelta: { foreign: -2 }, planetPulse: { annualEmissions: 1.5 },
    flavor: 'A non-member ramps production to eat the market share you just vacated.' },
  { id: 'coalition-defection', name: 'Coalition defection', tone: 'hostile', baseWeight: 1.0,
    healthDelta: { foreign: -2, treasury: -1 },
    flavor: 'A member state quietly walks back its commitments before the ink dries.' },
  { id: 'summit-collapse', name: 'Summit collapses', tone: 'hostile', baseWeight: 0.9,
    cabinetHealthDelta: -0.5,
    flavor: 'Two weeks of negotiation produce a communiqué and nothing else.' },
  { id: 'election-loss-signal', name: 'Coalition partner loses election', tone: 'hostile', baseWeight: 0.9,
    healthDelta: { treasury: -2, energy: -1 },
    flavor: 'A friendly government falls; its replacement ran against the whole agenda.' },
  { id: 'industry-relocation', name: 'Industry relocates', tone: 'hostile', baseWeight: 0.9,
    healthDelta: { energy: -2 }, planetPulse: { annualEmissions: 1.0 },
    flavor: 'Heavy industry moves offshore to a jurisdiction that asks fewer questions.' },
  { id: 'carbon-border-retaliation', name: 'Trade retaliation', tone: 'hostile', baseWeight: 0.8,
    healthDelta: { treasury: -2, foreign: -1 },
    flavor: 'Your border measure is met with tariffs of their own.' },
  { id: 'price-spike', name: 'Energy price spike', tone: 'hostile', baseWeight: 1.0,
    healthDelta: { energy: -2, treasury: -1 },
    flavor: 'A supply shock sends bills up and puts your name on every front page.' },
  { id: 'legislative-obstruction', name: 'Legislative obstruction', tone: 'hostile', baseWeight: 0.8,
    cabinetHealthDelta: -0.5,
    flavor: 'The upper house discovers a sudden and total interest in procedure.' },
  { id: 'fuel-protests', name: 'Fuel protests', tone: 'hostile', baseWeight: 0.9,
    healthDelta: { energy: -2, resilience: -1 },
    flavor: 'Convoys block the capital. The demand is simple: make it cheaper.' },
  { id: 'debt-crisis', name: 'Sovereign debt crisis', tone: 'hostile', baseWeight: 0.7,
    healthDelta: { treasury: -3 },
    flavor: 'The bond market decides your transition plan is a liability, not an asset.' },
  { id: 'modelling-error-scandal', name: 'The tipping-point "error"', tone: 'hostile', baseWeight: 0.7,
    healthDelta: { environment: -2, resilience: -2 },
    flavor: 'One retracted projection is used for a decade to discredit all the others.' },
  { id: 'media-backlash', name: 'Media backlash', tone: 'hostile', baseWeight: 0.8,
    healthDelta: { environment: -2 },
    flavor: 'A campaign reframes every restoration win as money burned on scenery.' },

  // ---- Opportunity (weight rises as the cabinet holds together) ----
  { id: 'diplomacy-opening', name: 'Diplomacy opening', tone: 'opportunity', baseWeight: 1.0,
    healthDelta: { foreign: 2 }, planetPulse: { annualEmissions: -0.8 },
    flavor: 'A back channel opens with a state everyone had written off.' },
  { id: 'compliance-offer', name: 'Non-member compliance offer', tone: 'opportunity', baseWeight: 0.9,
    healthDelta: { foreign: 1 }, planetPulse: { annualEmissions: -1.2 },
    flavor: 'A free-rider offers to fall in line — for a price you can actually pay.' },
  { id: 'green-investment-boom', name: 'Green investment boom', tone: 'opportunity', baseWeight: 1.0,
    healthDelta: { treasury: 2, energy: 1 },
    flavor: 'Private capital finally believes the direction of travel and floods in.' },
  { id: 'public-mandate', name: 'Fresh public mandate', tone: 'opportunity', baseWeight: 0.9,
    cabinetHealthDelta: 1,
    flavor: 'A heat season concentrates minds; the public briefly wants you to act.' },
  { id: 'tech-breakthrough', name: 'Technology breakthrough', tone: 'opportunity', baseWeight: 0.9,
    healthDelta: { energy: 2 }, planetPulse: { annualEmissions: -0.6 },
    flavor: 'Storage gets cheap enough to change the arithmetic of the grid.' },
  { id: 'summit-success', name: 'Summit succeeds', tone: 'opportunity', baseWeight: 0.7,
    healthDelta: { foreign: 2 }, planetPulse: { annualEmissions: -1.0 },
    flavor: 'Against every expectation, the room agrees to something binding.' },
  { id: 'coalition-solidarity', name: 'Coalition solidarity', tone: 'opportunity', baseWeight: 0.9,
    cabinetHealthDelta: 0.5,
    flavor: 'Members close ranks and share the political cost of a hard decision.' },
  { id: 'favorable-ruling', name: 'Favourable court ruling', tone: 'opportunity', baseWeight: 0.8,
    healthDelta: { environment: 2 },
    flavor: 'A high court enshrines a protected area beyond the reach of the next government.' },
  { id: 'bond-market-confidence', name: 'Bond-market confidence', tone: 'opportunity', baseWeight: 0.8,
    healthDelta: { treasury: 2 },
    flavor: 'Yields fall as investors price in a credible long-term plan.' },

  // ---- Neutral ----
  { id: 'quiet-round', name: 'A quiet round', tone: 'neutral', baseWeight: 0.6,
    flavor: 'The world, briefly, has its attention elsewhere.' },
  { id: 'reshuffle-rumour', name: 'Reshuffle rumours', tone: 'neutral', baseWeight: 0.5,
    flavor: 'The lobby is sure someone is about to be moved. Nobody is, yet.' },
  { id: 'international-attention', name: 'International spotlight', tone: 'neutral', baseWeight: 0.5,
    healthDelta: { resilience: 1 },
    flavor: 'For once the cameras are on the people who prepared, not the wreckage.' },
]

// A card's draw weight given cabinet cohesion. Instability 0 (solid) .. 1 (collapsing).
export function worldCardWeight(card: WorldCard, instability: number): number {
  const cohesion = 1 - instability
  const lean =
    card.tone === 'hostile' ? 0.3 + instability
    : card.tone === 'opportunity' ? 0.3 + cohesion
    : 0.5
  return card.baseWeight * lean
}

// Draw exactly one World Deck card, weighted by the current cabinet state.
export function drawWorldCard(instability: number, rng: Rng): WorldCard {
  const weights = WORLD_DECK.map((c) => worldCardWeight(c, instability))
  const total = weights.reduce((a, w) => a + w, 0)
  let r = rng.next() * total
  for (let i = 0; i < WORLD_DECK.length; i++) {
    r -= weights[i]!
    if (r <= 0) return WORLD_DECK[i]!
  }
  return WORLD_DECK[WORLD_DECK.length - 1]!
}
