import { definePage, ref } from '@vue-mini/core';

const createRows = () => Array.from({ length: 500 }, (_, index) => ({
  id: index,
  a: `r${index}-a`,
  b: `r${index}-b`,
  c: `r${index}-c`,
  d: `r${index}-d`,
  e: `r${index}-e`,
  f: `r${index}-f`,
  g: `r${index}-g`,
  h: `r${index}-h`,
}));

const rewriteRow = (row, tick) => ({
  ...row,
  a: `r${row.id}-a-${tick}`,
  b: `r${row.id}-b-${tick}`,
  c: `r${row.id}-c-${tick}`,
  d: `r${row.id}-d-${tick}`,
  e: `r${row.id}-e-${tick}`,
  f: `r${row.id}-f-${tick}`,
  g: `r${row.id}-g-${tick}`,
  h: `r${row.id}-h-${tick}`,
});

definePage(() => {
  const rows = ref(createRows());
  const tick = ref(0);

  const updateFirst = () => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row, index) => (
      index === 0 ? rewriteRow(row, nextTick) : row
    ));
  };

  const updateAll = () => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row) => rewriteRow(row, nextTick));
  };

  return { rows, tick, updateFirst, updateAll };
});
