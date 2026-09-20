/** One stable identity for both authored cell claims and gateway attribution. */
export function sheetCellRegionId(sheet, address) {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
  if (!match) return `${sheet.id}:${address}:${address}`;
  const rowId = sheet.rowIdentities?.[String(Number(match[2]) - 1)] ?? `${sheet.id}:row:${match[2]}`;
  const column = [...match[1]].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
  const columnId = sheet.columnIdentities?.[String(column)] ?? `${sheet.id}:column:${column + 1}`;
  return `${sheet.id}:${rowId}:${columnId}`;
}
