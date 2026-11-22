import { definePage, ref } from '@vue-mini/core';

const ROWS = Array.from({ length: 500 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
}));

definePage(() => {
  const rows = ref(ROWS.map((row) => ({ ...row })));
  const tick = ref(0);

  const updateFirst = () => {
    const nextTick = tick.value + 1;
    tick.value = nextTick;
    rows.value = rows.value.map((row, index) => (
      index === 0 ? { ...row, title: `Row 0 ${nextTick}` } : row
    ));
  };

  const updateAll = () => {
    const nextTick = tick.value + 1;
    const suffix = `${nextTick}-${Date.now() % 100000}`;
    tick.value = nextTick;
    rows.value = rows.value.map((row) => ({ ...row, title: `${row.title.split(' ').slice(0, 2).join(' ')} ${suffix}` }));
  };

  return { rows, tick, updateFirst, updateAll };
});
