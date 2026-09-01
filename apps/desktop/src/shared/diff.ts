// apps/desktop/src/shared/diff.ts
//
// Minimal line diff via LCS. Not Myers — fine for previewing a single edited
// file (capped). Returns unified-style rows.

export type DiffRow = { type: ' ' | '+' | '-'; text: string };

const MAX_LINES = 4000;

export function lineDiff(before: string, after: string): { rows: DiffRow[]; added: number; removed: number } {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return {
      rows: [{ type: ' ', text: `(file too large to diff — ${a.length} → ${b.length} lines)` }],
      added: 0,
      removed: 0,
    };
  }

  // LCS table
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: ' ', text: a[i]! });
      i++; j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ type: '-', text: a[i]! });
      removed++; i++;
    } else {
      rows.push({ type: '+', text: b[j]! });
      added++; j++;
    }
  }
  while (i < m) { rows.push({ type: '-', text: a[i]! }); removed++; i++; }
  while (j < n) { rows.push({ type: '+', text: b[j]! }); added++; j++; }

  return { rows, added, removed };
}
