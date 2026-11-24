import {
  CONTEXT_PROP,
  PAGE_PROP,
  STRUCTURED_PROP,
  isPrototypePropName,
} from '@glaze/shared'

/**
 * One predicate decides which props travel in the compact `glazeprops` object.
 * Build marks a component `structuredProps`, the parent groups attributes, and
 * the child projects reads through it; all three must agree or a prop is lost.
 */
const NON_GROUPABLE_PROPS = new Set([
  'class',
  'style',
  'id',
  'slot',
  'key',
  'children',
  CONTEXT_PROP,
  STRUCTURED_PROP,
  PAGE_PROP,
])

export const isEventProp = (name: string) => /^on[A-Z]/.test(name)

export const isGroupableProp = (name: string) =>
  !isEventProp(name) &&
  !NON_GROUPABLE_PROPS.has(name.toLowerCase()) &&
  !isPrototypePropName(name)

export const groupableProps = (props: string[]) => props.filter(isGroupableProp)

/** True when a component exposes at least two props the parent can group. */
export const hasGroupableProps = (props: string[]) => groupableProps(props).length >= 2
