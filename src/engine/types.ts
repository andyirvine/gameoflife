// Core engine types. Pure data. No React, no I/O, no side effects anywhere in /src/engine.

export type PortfolioId =
  | 'energy'
  | 'agriculture'
  | 'treasury'
  | 'foreign'
  | 'environment'
  | 'resilience'

export type Doctrine = 'accelerationist' | 'guardian' | 'dealmaker' | 'populist'

export type Severity = 'light' | 'moderate' | 'aggressive'

// Why a minister fell — determines the shape of their successor.
export type FallCause = 'price' | 'disaster' | 'coalition' | 'jobs'

// The successor archetype the cabinet's failure produces.
export type SuccessorArchetype = 'populist' | 'technocrat' | 'nationalist' | 'protectionist'

// An active menu lock inherited from succession. Forbids policies carrying `forbidsFlag`
// for a number of rounds. Technocrat carries no forbid (its effect is a discount + a
// lower starting health), so `forbidsFlag` may be null.
export type Restriction = {
  archetype: SuccessorArchetype
  forbidsFlag: ImpactFlag | null
  roundsRemaining: number
}

export type Minister = {
  portfolio: PortfolioId
  doctrine: Doctrine
  politicalHealth: number      // 0-10
  isPlayer: boolean
  generation: number           // 1 = original, increments on succession
  restrictions: Restriction[]  // active menu locks from succession
  transitionRounds: number     // rounds of reduced points after taking office
  // Health lost by cause during the current round, reset each round; the dominant cause
  // at the moment of a fall selects the successor archetype.
  roundLossByCause: Record<FallCause, number>
  // forecast: ForecastModel — added when forecasts are built (not a numbered step yet)
}

export type Cabinet = Minister[]

export type DeathChannel = 'heat' | 'food' | 'displacement' | 'disaster' | 'conflict'

// The world. Every number here is either a physical reading or a modelled human total.
export type PlanetState = {
  year: number
  tempAnomaly: number          // °C above pre-industrial
  co2: number                  // ppm
  annualEmissions: number      // GtCO2e — the GLOBAL total, = coalition + nonMember
  // The cabinet governs a climate coalition of ~30% of global emissions. Its domestic levers
  // move `coalitionEmissions`; the free-riding rest of the world (`nonMemberEmissions`) rises
  // on its own and bends only to the Foreign minister's diplomacy (CBAM, tech transfer,
  // coalition deals). Temperature is driven by the global total, so the outcome hinges on
  // dragging the 70% you don't control.
  coalitionEmissions: number   // GtCO2e from coalition members (directly governable)
  nonMemberEmissions: number   // GtCO2e from non-members (free-rides; bends only to diplomacy)
  methane: number              // ppb
  forestLossRate: number       // M ha/year
  wetlandRestored: number      // % vs baseline
  biodiversityIndex: number    // 0-100, 30 at baseline
  coralExtent: number          // % of 1990
  seaLevelRise: number         // cm cumulative
  oceanPh: number
  displacedAnnual: number      // millions/year
  displacedUnresettled: number // millions cumulative
  foodInsecure: number         // millions
  damagesPctGdp: number
  cumulativeDeaths: number     // only ever increases
}

// Named policy tags. Doctrine discounts and succession restrictions both read these,
// so the rules stay data-driven instead of six special cases in a switch.
export type PolicyTag =
  | 'mitigation'
  | 'adaptation'
  | 'relief'
  | 'restoration'
  | 'diplomacy'

// Impact flags that drive political fallout and succession-menu locks.
export type ImpactFlag =
  | 'raisesConsumerPrices'
  | 'removesLivelihoods'
  | 'spendsInternationally'

// Political cost paid immediately on commitment, by portfolio.
// The enacting portfolio always takes the largest share; spillover hits allies.
export type PoliticalCost = Partial<Record<PortfolioId, number>>

export type PolicyTier = {
  severity: Severity
  pointCost: number
  lag: number                      // 1-6 rounds
  effects: Partial<PlanetState>    // deltas applied on landing
  politicalCost: PoliticalCost     // immediate, by portfolio
  locksIn: boolean
  upkeep?: number                  // points/round if it decays
  // How much this tier feeds the two mitigation stocks when it lands.
  // These are the only things that damp the death channels.
  adaptationValue?: number
  resilienceValue?: number
  // Clears displaced-unresettled stock when it lands (resettlement programmes).
  resettleValue?: number
}

export type Policy = {
  id: string
  name: string
  domain: PortfolioId
  tags: PolicyTag[]
  flags: ImpactFlag[]
  tiers: [PolicyTier, PolicyTier, PolicyTier]  // light, moderate, aggressive
}

export type PipelineEntry = {
  policyId: string
  severity: Severity
  enactedRound: number
  landsRound: number
  enactedBy: PortfolioId
  enactedByGeneration: number
  effects: Partial<PlanetState>
  adaptationValue: number
  resilienceValue: number
  resettleValue: number
}

// Accumulated, decaying stocks of protective capacity. Fed by policies as they land.
export type MitigationStocks = {
  adaptation: number   // damps heat + disaster
  resilience: number   // damps displacement + disaster
}

export type DeathLedgerEntry = {
  round: number
  year: number
  byChannel: Record<DeathChannel, number>
  total: number
  cumulative: number
  drivers: string[]
  preventable: PreventableMoment[]
}

export type PreventableMoment = {
  channel: DeathChannel
  availablePolicy: string
  pointsRequired: number
  cabinetPointsUnspent: number
  deathsAvoidable: number   // estimated reduction this round had it been enacted
}
