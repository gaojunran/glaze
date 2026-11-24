import { dataKey, normalizeDataValue } from './data.ts'

import type { DataChange } from './types.ts'

type DataGroup = {
  getChanges(): unknown[]
  setChanges(changes: unknown[]): void
  applyDataUpdates(): void
}

type TransportComponent = {
  setData(data: Record<string, unknown>): void
  groupUpdates?: (run: () => void) => void
  replaceDataOnPath?: (path: (string | number)[], value: unknown) => void
  spliceArrayDataOnPath?: (
    path: (string | number)[],
    index: number,
    del: number,
    inserts: unknown[],
  ) => void
  _$dataGroup?: Partial<DataGroup>
}

export type DataTransportKind = 'data-group' | 'grouped' | 'set-data'

export type DataTransport = {
  /**
   * False when a splice is not safe to choose for a change. Callers must then
   * send a whole value; `apply` throws when the transport has no splice API at
   * all, but a grouped splice-only transport may still commit a lone splice.
   */
  readonly canSplice: boolean
  /** Debug label for the resolved capability path. */
  readonly kind: DataTransportKind
  apply(changes: readonly DataChange[]): void
}

// Injected by the mini-program host, same global the component definition uses.
declare const Component: { getDataProxy?: (component: unknown) => Partial<DataGroup> } | undefined

const spliceUnsupported = () =>
  new Error('[glaze] data transport cannot commit a splice; send the whole value instead')

/**
 * Resolve the component's data-update capability once. The `DataGroup` queue is
 * preferred because replace and splice tuples share one template update. When
 * it is absent, `groupUpdates` plus the path APIs is the next best transport.
 * A grouped transport without `replaceDataOnPath` queues replacements for
 * `setData` after the group, so a mixed batch could replace a list right after
 * splicing it; only expose `canSplice` when both path APIs exist.
 */
export function createDataTransport(component: TransportComponent): DataTransport {
  const group = dataGroupOf(component)
  if (group) {
    return {
      kind: 'data-group',
      canSplice: true,
      apply: (changes) => applyDataGroup(group, changes),
    }
  }
  const grouped = typeof component.groupUpdates === 'function'
  const replace = grouped && typeof component.replaceDataOnPath === 'function'
  const splice = grouped && typeof component.spliceArrayDataOnPath === 'function'
  if (replace || splice) {
    return {
      kind: 'grouped',
      canSplice: replace && splice,
      apply: (changes) => applyGrouped(component, replace, splice, changes),
    }
  }
  return {
    kind: 'set-data',
    canSplice: false,
    apply: (changes) => applySetData(component, changes),
  }
}

function dataGroupOf(component: TransportComponent): DataGroup | undefined {
  const candidate =
    (typeof Component === 'undefined' ? undefined : Component.getDataProxy?.(component)) ??
    component._$dataGroup
  return candidate &&
    typeof candidate.getChanges === 'function' &&
    typeof candidate.setChanges === 'function' &&
    typeof candidate.applyDataUpdates === 'function'
    ? (candidate as DataGroup)
    : undefined
}

function applyDataGroup(group: DataGroup, changes: readonly DataChange[]): void {
  // Keep whatever another writer queued before this flush, then append ours as
  // glass-easel's own `DataReplace` / `DataSplice` tuples.
  const queued = group.getChanges() ?? []
  group.setChanges([
    ...queued,
    ...changes.map((change) =>
      change.splice
        ? [change.path, change.splice.inserts, change.splice.index, change.splice.del]
        : [change.path, normalizeDataValue(change.value), undefined, undefined],
    ),
  ])
  group.applyDataUpdates()
}

function applyGrouped(
  component: TransportComponent,
  replace: boolean,
  splice: boolean,
  changes: readonly DataChange[],
): void {
  // Validate before running the group so a rejected change cannot leave a
  // partially queued update behind.
  if (!splice && changes.some((change) => change.splice)) throw spliceUnsupported()
  const replacements: DataChange[] = []
  component.groupUpdates!(() => {
    for (const change of changes) {
      if (change.splice) {
        component.spliceArrayDataOnPath!(
          change.path,
          change.splice.index,
          change.splice.del,
          change.splice.inserts,
        )
      } else if (replace) {
        component.replaceDataOnPath!(change.path, normalizeDataValue(change.value))
      } else {
        replacements.push(change)
      }
    }
  })
  if (replacements.length > 0) {
    component.setData(
      Object.fromEntries(
        replacements.map((change) => [dataKey(change.path), normalizeDataValue(change.value)]),
      ),
    )
  }
}

function applySetData(component: TransportComponent, changes: readonly DataChange[]): void {
  if (changes.some((change) => change.splice)) throw spliceUnsupported()
  component.setData(
    Object.fromEntries(
      changes.map((change) => [dataKey(change.path), normalizeDataValue(change.value)]),
    ),
  )
}
