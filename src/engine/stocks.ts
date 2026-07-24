import type { MitigationStocks, PipelineEntry } from './types.ts'

// The two protective stocks decay if unmaintained (~5%/round), so a cabinet that stops
// investing watches its flood defences and cooling capacity erode exactly when the
// Events Deck heats up.
const STOCK_DECAY = 0.05

export function initStocks(): MitigationStocks {
  return { adaptation: 0, resilience: 0 }
}

// Decay first, then add whatever landed this round. `landed` is the pipeline entries
// whose landsRound is the current round.
export function stepStocks(prev: MitigationStocks, landed: PipelineEntry[]): MitigationStocks {
  let adaptation = prev.adaptation * (1 - STOCK_DECAY)
  let resilience = prev.resilience * (1 - STOCK_DECAY)
  for (const e of landed) {
    adaptation += e.adaptationValue
    resilience += e.resilienceValue
  }
  return { adaptation, resilience }
}
