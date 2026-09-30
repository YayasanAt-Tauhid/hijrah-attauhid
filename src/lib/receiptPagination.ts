export function receiptPageRanges(height: number, pageHeight: number, rowEnds: number[]) {
  const ranges: { offset: number; end: number }[] = [];
  for (let offset = 0; offset < height;) {
    const limit = Math.min(offset + pageHeight, height);
    const candidates = rowEnds.filter(end => end > offset && end <= limit);
    const end = limit < height && candidates.length ? Math.max(...candidates) : limit;
    ranges.push({ offset, end });
    offset = end;
  }
  return ranges;
}
