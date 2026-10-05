import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readRepoFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const css = readRepoFile('src/index.css')
const branding = readRepoFile('src/lib/branding.ts')
const single = readRepoFile('src/components/shared/PrintKuitansi.tsx')
const combined = readRepoFile('src/components/shared/PrintKuitansiGabungan.tsx')
const selector = readRepoFile('src/components/shared/ReceiptOrientationSelect.tsx')
const cashier = readRepoFile('src/pages/keuangan/InputPembayaran.tsx')
const spmb = readRepoFile('src/pages/keuangan/PembayaranPMB.tsx')
const recap = readRepoFile('src/pages/keuangan/RekapKasirSaya.tsx')

describe('receipt print layout contract', () => {
  it('supports landscape and portrait continuous-form page sizes with safe printable widths', () => {
    expect(css).toContain('@page kuitansi-landscape')
    expect(css).toContain('size: 241mm 140mm')
    expect(css).toContain('@page kuitansi-portrait')
    expect(css).toContain('size: 140mm 241mm')
    expect(css).toContain('width: 201mm !important')
    expect(css).toContain('width: 120mm !important')
    expect(single).toContain('data-print-orientation={orientation}')
    expect(combined).toContain('data-print-orientation={orientation}')
  })


  it('defaults to landscape and exposes an orientation selector on receipt print flows', () => {
    expect(single).toContain('orientation = "landscape"')
    expect(combined).toContain('orientation = "landscape"')
    expect(selector).toContain('Landscape — disarankan')
    expect(selector).toContain('<SelectItem value="portrait">Portrait</SelectItem>')
    expect(cashier).toContain('<ReceiptOrientationSelect')
    expect(spmb).toContain('<ReceiptOrientationSelect')
    expect(recap).toContain('<ReceiptOrientationSelect')
  })

  it('uses the official vertical foundation logo for printed receipts', () => {
    expect(branding).toContain('YAYASAN_PRINT_LOGO_URL = "/branding/yayasan-at-tauhid.png"')
    expect(single).toContain('src={YAYASAN_PRINT_LOGO_URL}')
    expect(combined).toContain('src={YAYASAN_PRINT_LOGO_URL}')
  })

  it('keeps the existing receipt font sizes while tightening receipt spacing', () => {
    expect(single).toContain('text-[12pt] leading-[1.15]')
    expect(combined).toContain('text-[12pt] leading-[1.15]')
    expect(single).toContain('text-[12.5pt]')
    expect(combined).toContain('text-[12.5pt]')
  })
})
