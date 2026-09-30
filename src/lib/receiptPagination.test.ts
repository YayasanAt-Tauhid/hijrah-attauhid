import { describe, it, expect } from "vitest";
import { receiptPageRanges } from "./receiptPagination";
describe("Receipt PDF pagination", () => {
  it("keeps a short receipt on one page", () => {
    expect(receiptPageRanges(490, 550, [100,200,400])).toEqual([{ offset: 0, end: 490 }]);
  });
  it("breaks long receipts between complete rows with no missing content", () => {
    expect(receiptPageRanges(1200, 550, [100,300,500,700,900,1100])).toEqual([
      {offset:0,end:500},{offset:500,end:900},{offset:900,end:1200},
    ]);
  });
  it("still advances when there are no row boundaries", () => {
    expect(receiptPageRanges(900,550,[])).toEqual([{offset:0,end:550},{offset:550,end:900}]);
  });
});
