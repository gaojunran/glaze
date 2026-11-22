export const WXS_SOURCE = `function range(count, from) {
  var n = (count - 0) || 0;
  var start = (from - 0) || 0;
  var list = [];
  for (var i = 0; i < n; i += 1) list.push(start + i);
  return list;
}
function single(value) { return [value]; }
module.exports = { range: range, single: single };`
