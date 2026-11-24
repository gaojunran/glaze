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

  const bump = () => {
    tick.value += 1;
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

  const updateRange = (count) => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row, index) =>
      index < count ? { ...row, title: `Row ${row.id} ${nextTick}` } : row,
    );
  };

  const insertMid = () => {
    const id = -100000 - tick.value;
    const nextTick = tick.value + 1;
    const next = [...rows.value];
    next.splice(2500, 0, { id, title: `Row ${id}`, done: false, extra: 'x' });
    tick.value = nextTick;
    rows.value = next;
  };

  const deleteMid = () => {
    const next = [...rows.value];
    next.splice(2500, 1);
    rows.value = next;
  };

  const insertTail = () => {
    const id = 100000 + tick.value;
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = [...rows.value, { id, title: `Row ${id}`, done: false, extra: 'x' }];
  };

  const deleteTail = () => {
    rows.value = rows.value.slice(0, -1);
  };

  return { rows, tick, bump, updateFirst, toggleFirst, insertFirst, deleteFirst, reverse,
    update10: () => updateRange(10), update100: () => updateRange(100), update500: () => updateRange(500),
    insertMid, deleteMid, insertTail, deleteTail };
});
