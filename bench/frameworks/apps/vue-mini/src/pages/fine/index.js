import { definePage, ref } from '@vue-mini/core';

const ROWS = Array.from({ length: 5000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
  extra: 'x'.repeat(2000),
}));

definePage(() => {
  const rows = ref(ROWS.map((row) => ({ ...row })));
  const tick = ref(0);

  const updateFirst = () => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row, index) =>
      index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row,
    );
  };

  const toggleFirst = () => {
    rows.value = rows.value.map((row, index) =>
      index === 0 ? { ...row, done: !row.done } : row,
    );
  };

  const insertFirst = () => {
    const id = -1 - tick.value;
    rows.value = [{ id, title: `Row ${id}`, done: false }, ...rows.value];
  };

  const deleteFirst = () => {
    rows.value = rows.value.slice(1);
  };

  const reverse = () => {
    rows.value = [...rows.value].reverse();
  };

  return { rows, tick, updateFirst, toggleFirst, insertFirst, deleteFirst, reverse };
});
