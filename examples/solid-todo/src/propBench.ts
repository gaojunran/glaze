export type PropRow = {
  id: number
  p1: string
  p2: string
  p3: string
  p4: string
  p5: string
  p6: string
  p7: string
  p8: string
  p9: string
  p10: string
  p11: string
  p12: string
  p13: string
  p14: string
  p15: string
  p16: string
}

export const createPropRows = (): PropRow[] =>
  Array.from({ length: 500 }, (_, id) => ({
    id,
    p1: `r${id}-p1`, p2: `r${id}-p2`, p3: `r${id}-p3`, p4: `r${id}-p4`,
    p5: `r${id}-p5`, p6: `r${id}-p6`, p7: `r${id}-p7`, p8: `r${id}-p8`,
    p9: `r${id}-p9`, p10: `r${id}-p10`, p11: `r${id}-p11`, p12: `r${id}-p12`,
    p13: `r${id}-p13`, p14: `r${id}-p14`, p15: `r${id}-p15`, p16: `r${id}-p16`,
  }))

/** Rewrite the first `count` props with a new suffix, leaving the rest alone. */
export const bumpProps = (row: PropRow, tick: number, count: number): PropRow => {
  const next = { ...row }
  for (let p = 1; p <= count; p += 1) {
    const key = `p${p}` as keyof PropRow
    if (key !== 'id') next[key] = `r${row.id}-p${p}-${tick}`
  }
  return next
}
