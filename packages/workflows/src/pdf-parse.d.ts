declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfData { text: string; numpages: number; [key: string]: unknown }
  function pdf(data: Buffer | Uint8Array): Promise<PdfData>;
  export default pdf;
}
