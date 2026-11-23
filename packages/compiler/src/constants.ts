export const STRUCTURED_PROPS = 'glazeprops'

// Built-in WXML tags. A component name must not kebab-case onto one of these,
// or the generated tree mixes a user component with a native element.
export const BUILTIN_TAGS: ReadonlySet<string> = new Set([
  'ad',
  'audio',
  'block',
  'button',
  'camera',
  'canvas',
  'checkbox',
  'cover-image',
  'cover-view',
  'editor',
  'form',
  'icon',
  'image',
  'import',
  'include',
  'input',
  'label',
  'live-player',
  'live-pusher',
  'map',
  'movable-area',
  'movable-view',
  'navigator',
  'official-account',
  'open-data',
  'page-meta',
  'picker',
  'picker-view',
  'picker-view-column',
  'progress',
  'radio',
  'rich-text',
  'scroll-view',
  'slider',
  'slot',
  'swiper',
  'swiper-item',
  'switch',
  'template',
  'text',
  'textarea',
  'video',
  'view',
  'web-view',
  'wxs',
])

export const WXS_VALUE_SOURCE = `function value(v) {
  return (v === true || v === false) ? '' : v;
}
module.exports = { value: value };`

export const WXS_SOURCE = `function range(count, from) {
  var n = (count - 0) || 0;
  var start = (from - 0) || 0;
  var list = [];
  for (var i = 0; i < n; i += 1) list.push(start + i);
  return list;
}
function single(value) { return [value]; }
module.exports = { range: range, single: single };`
