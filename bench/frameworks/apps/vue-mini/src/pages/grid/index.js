import { definePage, ref } from '@vue-mini/core';

const ROWS = Array.from({ length: 80 }, (_, row) => ({
  id: row,
  cells: Array.from({ length: 25 }, (_, cell) => ({ id: cell, value: row * 25 + cell })),
}));

const cloneRows = () => ROWS.map((row) => ({
  ...row,
  cells: row.cells.map((cell) => ({ ...cell })),
}));

definePage(() => {
  const rows = ref(cloneRows());

  const updateCell = () => {
    rows.value = rows.value.map((row, rowIndex) => (
      rowIndex === 0
        ? {
            ...row,
            cells: row.cells.map((cell, cellIndex) => (
              cellIndex === 0 ? { ...cell, value: cell.value + 1 } : cell
            )),
          }
        : row
    ));
  };

  const updateRow = () => {
    rows.value = rows.value.map((row, rowIndex) => (
      rowIndex === 0
        ? {
            ...row,
            cells: row.cells.map((cell) => ({ ...cell, value: cell.value + 1 })),
          }
        : row
    ));
  };

  return { rows, updateCell, updateRow };
});
