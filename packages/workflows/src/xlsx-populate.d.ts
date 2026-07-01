declare module 'xlsx-populate' {
  type CellValue = string | number | boolean | null | undefined;

  interface Cell {
    value(): CellValue;
    value(value: CellValue): Cell;
  }

  interface Range {
    value(): CellValue[][];
    value(values: CellValue[][]): Range;
    autoFilter(): Range;
  }

  interface Sheet {
    cell(ref: string): Cell;
    cell(rowNumber: number, columnNameOrNumber: number | string): Cell;
    range(ref: string): Range;
  }

  interface Workbook {
    sheet(indexOrName: number | string): Sheet;
    outputAsync(opts?: { password?: string }): Promise<ArrayBuffer | Buffer | Uint8Array>;
  }

  interface XlsxPopulateStatic {
    fromBlankAsync(): Promise<Workbook>;
    fromDataAsync(data: Buffer | Uint8Array, opts?: { password?: string }): Promise<Workbook>;
  }

  const XlsxPopulate: XlsxPopulateStatic;
  export default XlsxPopulate;
}
