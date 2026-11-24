import { definePage, ref } from '@vue-mini/core';

const ROWS = Array.from({ length: 2000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  meta: { tag: `tag-${index}` },
}));

const cloneRows = () => ROWS.map((row) => ({ ...row, meta: { ...row.meta } }));

definePage(() => {
  const rows = ref(cloneRows());
  const tick = ref(0);

  const updateDeep = () => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row, index) => (
      index === 0
        ? { ...row, meta: { ...row.meta, tag: `tag-${row.id}-${nextTick}` } }
        : row
    ));
  };

  const rotate = () => {
    rows.value = rows.value.length === 0
      ? rows.value
      : [rows.value[rows.value.length - 1], ...rows.value.slice(0, -1)];
  };

  const reverse = () => {
    rows.value = [...rows.value].reverse();
  };

  const moveFront = () => {
    const next = [...rows.value];
    const [row] = next.splice(1000, 1);
    rows.value = [row, ...next];
  };

  const swap = () => {
    if (rows.value.length < 2) return;
    const next = [...rows.value];
    const last = next.length - 1;
    [next[0], next[last]] = [next[last], next[0]];
    rows.value = next;
  };

  return { rows, tick, updateDeep, rotate, reverse, moveFront, swap };
});
