import { createMemo } from 'solid-js'
import { loadingOf, settledOf, type BoundaryState } from './boundary.ts'

export type RevealOrder = 'sequential' | 'together' | 'natural'

export type RevealSlotState = {
  gated: boolean
  hidden: boolean
}

export type RevealGroup = {
  gated(boundary: number): boolean
  hidden(boundary: number): boolean
}

/**
 * The mini-program side of `<Reveal>`. Solid's controller owns boundary
 * outputs directly; Glaze has no boundary objects, so the same order is
 * derived from the Loading boundary's `settled` and `loading` signals.
 *
 * A slot is ready when it has shown content or has nothing pending. Slots
 * that showed once stay ready through refetches, matching Solid's graduated
 * slots. `gated` means "show the fallback"; `hidden` is a collapsed
 * sequential tail and renders nothing.
 */
export function createRevealGroup(
  boundaries: BoundaryState,
  slots: readonly number[],
  order: () => RevealOrder,
  collapsed: () => boolean,
): RevealGroup {
  const states = createMemo<Record<number, RevealSlotState>>(() => {
    const mode = order()
    const hideTail = collapsed()
    const effectiveOrder = mode === 'together' || mode === 'natural' ? mode : 'sequential'
    const ready = (slot: number) =>
      settledOf(boundaries, slot) || !loadingOf(boundaries, slot)
    const result: Record<number, RevealSlotState> = {}

    if (effectiveOrder === 'natural') {
      for (const slot of slots) result[slot] = { gated: !ready(slot), hidden: false }
      return result
    }

    if (effectiveOrder === 'together') {
      const allReady = slots.every(ready)
      for (const slot of slots) result[slot] = { gated: !allReady, hidden: false }
      return result
    }

    let frontier = false
    for (const slot of slots) {
      if (frontier) {
        result[slot] = { gated: true, hidden: hideTail }
        continue
      }
      if (ready(slot)) {
        result[slot] = { gated: false, hidden: false }
        continue
      }
      frontier = true
      result[slot] = { gated: true, hidden: false }
    }
    return result
  })

  return {
    gated: (boundary) => states()[boundary]?.gated ?? false,
    hidden: (boundary) => states()[boundary]?.hidden ?? false,
  }
}
