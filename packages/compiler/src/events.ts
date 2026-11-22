
export const EVENT_MAP: Record<string, string> = {
  onClick: 'tap',
  onTap: 'tap',
  onInput: 'input',
  onChange: 'change',
  onConfirm: 'confirm',
  onFocus: 'focus',
  onBlur: 'blur',
  onSubmit: 'submit',
  onReset: 'reset',
  onScroll: 'scroll',
  onScrollToLower: 'scrolltolower',
  onScrollToUpper: 'scrolltoupper',
  onLoad: 'load',
  onError: 'error',
  onTimeUpdate: 'timeupdate',
  onEnded: 'ended',
  onPlay: 'play',
  onPause: 'pause',
  onProgress: 'progress',
  onColumnChange: 'columnchange',
  onLineChange: 'linechange',
  onRegionChange: 'regionchange',
  onMarkertap: 'markertap',
  onCalloutTap: 'callouttap',
  onLabelTap: 'labeltap',
  onControlTap: 'controltap',
  onLongPress: 'longpress',
  onLongTap: 'longtap',
  onTouchStart: 'touchstart',
  onTouchMove: 'touchmove',
  onTouchEnd: 'touchend',
  onTouchCancel: 'touchcancel',
  onAnimationStart: 'animationstart',
  onAnimationIteration: 'animationiteration',
  onAnimationEnd: 'animationend',
  onTransitionEnd: 'transitionend',
}

// Base prop names that a native element can bind. A custom component event
// with one of these names would be ambiguous with a bubbling native event, so
// component tags reject them instead of silently sharing a handler.
export const NATIVE_EVENT_PROPS: ReadonlySet<string> = new Set(Object.keys(EVENT_MAP))

// Longest suffixes first: onClickCaptureCatch must not be read as onClickCatch.
const EVENT_BINDINGS: Array<[string, string]> = [
  ['CaptureCatch', 'capture-catch'],
  ['CaptureMutBind', 'capture-mut-bind'],
  ['Capture', 'capture-bind'],
  ['MutBind', 'mut-bind'],
  ['Catch', 'catch'],
  ['', 'bind'],
]

const COMPONENT_EVENT_PREFIX: Record<string, string> = {
  bind: 'bind:',
  catch: 'catch:',
  'mut-bind': 'mut-bind:',
  'capture-bind': 'capture-bind:',
  'capture-catch': 'capture-catch:',
  'capture-mut-bind': 'capture-mut-bind:',
}

const NATIVE_EVENT_PREFIX: Record<string, string> = {
  bind: 'bind',
  catch: 'catch',
  'mut-bind': 'mut-bind:',
  'capture-bind': 'capture-bind:',
  'capture-catch': 'capture-catch:',
  'capture-mut-bind': 'capture-mut-bind:',
}

export const splitEventBinding = (prop: string): { base: string; kind: string } | null => {
  for (const [suffix, kind] of EVENT_BINDINGS) {
    if (suffix && !prop.endsWith(suffix)) continue
    const base = suffix ? prop.slice(0, -suffix.length) : prop
    if (!/^on[A-Z]/.test(base)) continue
    return { base, kind }
  }
  return null
}

export const eventAttrFor = (kind: string, eventName: string, custom: boolean): string =>
  `${(custom ? COMPONENT_EVENT_PREFIX : NATIVE_EVENT_PREFIX)[kind]}${eventName}`

export const eventNameFor = (prop: string): string => {
  const rest = prop.slice(2)
  return rest.charAt(0).toLowerCase() + rest.slice(1)
}
