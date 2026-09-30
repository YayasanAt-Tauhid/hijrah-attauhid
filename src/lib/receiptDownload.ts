import type { PrintKuitansiGabunganProps } from "@/components/shared/PrintKuitansiGabungan";

import { receiptPageRanges } from "./receiptPagination";

export type PortalReceipt = Omit<PrintKuitansiGabunganProps, "exportMode" | "onExportReady">;
export const canDownloadReceipt = (status: string) => status === "paid";

export async function downloadReceiptPdf(element: HTMLElement, reference: string) {
  await document.fonts.ready;
  await Promise.all(Array.from(element.querySelectorAll("img")).map(async (img) => {
    await img.decode();
    if (!img.naturalWidth) throw new Error("Logo kwitansi belum berhasil dimuat");
  }));
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
    windowWidth: 1024,
    scrollX: 0,
    scrollY: 0,
  });
  if (!canvas.width || !canvas.height) throw new Error("Kwitansi belum siap diunduh");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [229, 162], compress: true });
  const contentWidth = 213;
  const pageHeight = 146;
  const pixelsPerMm = canvas.width / contentWidth;
  const pixelsPerPage = Math.floor(pageHeight * pixelsPerMm);
  // Discard only trailing white canvas padding; retain every visible pixel.
  const sourceContext = canvas.getContext("2d");
  if (!sourceContext) throw new Error("Browser tidak dapat membuat PDF kwitansi");
  const pixels = sourceContext.getImageData(0, 0, canvas.width, canvas.height).data;
  let contentHeight = canvas.height;
  while (contentHeight > 1) {
    const rowStart = (contentHeight - 1) * canvas.width * 4;
    let hasInk = false;
    for (let x = 0; x < canvas.width; x++) {
      const index = rowStart + x * 4;
      if (pixels[index + 3] > 0 && (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250)) {
        hasInk = true;
        break;
      }
    }
    if (hasInk) break;
    contentHeight--;
  }
  const bounds = element.getBoundingClientRect();
  const scale = canvas.width / bounds.width;
  const rowEnds = Array.from(element.querySelectorAll("tr"))
    .map(row => Math.ceil((row.getBoundingClientRect().bottom - bounds.top) * scale));
  const pages = receiptPageRanges(contentHeight, pixelsPerPage, rowEnds);
  for (const [page, { offset, end }] of pages.entries()) {
    if (page) pdf.addPage([229, 162], "landscape");
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = end - offset;
    const ctx = slice.getContext("2d");
    if (!ctx) throw new Error("Browser tidak dapat membuat PDF kwitansi");
    ctx.drawImage(canvas, 0, offset, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    pdf.addImage(slice, "PNG", 8, 8, contentWidth, slice.height / pixelsPerMm);
  }
  const safeReference = reference.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  pdf.save(`Kwitansi-${safeReference || "Pembayaran"}.pdf`);
}
