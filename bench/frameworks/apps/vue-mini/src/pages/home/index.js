import { definePage, ref } from '@vue-mini/core';

const ROWS = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`,
  done: index % 2 === 0,
}));

definePage(() => {
  const rows = ref(ROWS.map((row) => ({ ...row })));
  const tick = ref(0);
  const title = ref('');

  const updateFirst = () => {
    rows.value[0] = { ...rows.value[0], title: `Row 0 ${tick.value + 1}` };
    tick.value += 1;
  };

  const reverse = () => {
    rows.value = [...rows.value].reverse();
  };

  return { rows, tick, title, updateFirst, reverse };
});
