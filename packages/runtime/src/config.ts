import { CONTEXT_PROP, STRUCTURED_PROP } from '@glaze/shared'
import type { GlazeComponentConfig } from './types.ts'

const invalid = (message: string): never => {
  throw new Error(`[glaze] invalid component config: ${message}`)
}

/**
 * Reject configuration that would silently disable a generated feature.
 * Validation stays at this single entry point so hand-written components get
 * the same guarantees as compiler output without duplicating checks in setup.
 */
export function validateConfig(config: GlazeComponentConfig): void {
  const properties = config.properties ?? []
  const propertyNames = properties.map((name) => name.toLowerCase())
  if (new Set(propertyNames).size !== propertyNames.length) {
    invalid('property names collide after lowercasing')
  }

  const known = new Set(propertyNames)
  if (config.structuredProps) known.add(STRUCTURED_PROP)
  if ((config.boundaryContexts?.length ?? 0) > 0) known.add(CONTEXT_PROP)
  if (
    config.componentFramework !== undefined &&
    config.componentFramework !== 'exparser'
  ) {
    invalid('componentFramework must be "exparser" when present')
  }
  for (const name of config.propSignals ?? []) {
    if (!known.has(name.toLowerCase())) {
      invalid(`propSignals entry "${name}" is not a declared property`)
    }
  }

  if (
    config.bindingGroupSize !== undefined &&
    (!Number.isInteger(config.bindingGroupSize) || config.bindingGroupSize <= 0)
  ) {
    invalid('bindingGroupSize must be a positive integer')
  }
  if (
    config.handlerCount !== undefined &&
    (!Number.isInteger(config.handlerCount) || config.handlerCount < 0)
  ) {
    invalid('handlerCount must be a non-negative integer')
  }

  for (const [index, key] of Object.entries(config.listBindings ?? {})) {
    if (!/^\d+$/.test(index) || typeof key !== 'string' || key.length === 0) {
      invalid(`listBindings[${index}] must map a numeric binding to a non-empty key`)
    }
  }
  for (const [index, fields] of Object.entries(config.listFields ?? {})) {
    if (!Object.hasOwn(config.listBindings ?? {}, index)) {
      invalid(`listFields[${index}] has no matching listBindings entry`)
    }
    if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) {
      invalid(`listFields[${index}] must be an array of field names`)
    }
  }
  for (const status of config.asyncStatus ?? []) {
    if (!Number.isInteger(status.index) || status.index < 0) {
      invalid('asyncStatus.index must be a non-negative integer')
    }
    if (!Number.isInteger(status.boundary) || status.boundary < 0) {
      invalid('asyncStatus.boundary must be a non-negative integer')
    }
    if (status.kind !== 'loading' && status.kind !== 'error' && status.kind !== 'settled') {
      invalid('asyncStatus.kind must be "loading", "error" or "settled"')
    }
  }
}
