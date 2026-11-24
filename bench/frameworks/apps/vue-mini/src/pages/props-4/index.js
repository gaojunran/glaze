import { definePage, ref } from '@vue-mini/core';

const createRows = () => Array.from({ length: 500 }, (_, id) => ({
  id,
  p1: `r${id}-p1`,
  p2: `r${id}-p2`,
  p3: `r${id}-p3`,
  p4: `r${id}-p4`,
  p5: `r${id}-p5`,
  p6: `r${id}-p6`,
  p7: `r${id}-p7`,
  p8: `r${id}-p8`,
  p9: `r${id}-p9`,
  p10: `r${id}-p10`,
  p11: `r${id}-p11`,
  p12: `r${id}-p12`,
  p13: `r${id}-p13`,
  p14: `r${id}-p14`,
  p15: `r${id}-p15`,
  p16: `r${id}-p16`,
}));

const rewriteRow = (row, tick) => ({
  ...row,
  p1: `r${row.id}-p1-${tick}`,
  p2: `r${row.id}-p2-${tick}`,
  p3: `r${row.id}-p3-${tick}`,
  p4: `r${row.id}-p4-${tick}`,
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

  return { rows, updateFirst, updateAll };
});
