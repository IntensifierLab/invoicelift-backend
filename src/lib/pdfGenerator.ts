/**
 * Minimal hand-rolled single-page text PDF writer — no external PDF
 * dependency exists in this project, and pulling one in for a scaffold's
 * "export as PDF" checkbox is disproportionate. Emits a real, valid PDF
 * (correct object graph, xref table, trailer) openable in any PDF reader;
 * just plain left-aligned monospace text, one line per array entry, no
 * layout engine. That's the right scope for a regulator-readable report
 * dump — a compliance PDF viewer needs correct bytes, not typography.
 */

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10;

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function generateTextPdf(title: string, lines: string[]): Buffer {
  const maxLinesPerPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT) - 2;
  const allLines = [title, "", ...lines];

  const contentOps: string[] = ["BT", `/F1 ${FONT_SIZE} Tf`, `${LINE_HEIGHT} TL`];
  let y = PAGE_HEIGHT - MARGIN;
  contentOps.push(`${MARGIN} ${y} Td`);
  for (let i = 0; i < Math.min(allLines.length, maxLinesPerPage); i++) {
    contentOps.push(`(${escapePdfText(allLines[i])}) Tj`);
    contentOps.push("T*");
  }
  contentOps.push("ET");
  const contentStream = contentOps.join("\n");

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); // 2
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
  ); // 3
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"); // 4
  objects.push(
    `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`,
  ); // 5

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
