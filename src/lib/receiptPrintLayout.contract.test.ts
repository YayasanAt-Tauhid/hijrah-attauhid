import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readRepoFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const css = readRepoFile('src/index.css')
const branding = readRepoFile('src/lib/branding.ts')
const single = readRepoFile('src/components/shared/PrintKuitansi.tsx')
const combined = readRepoFile('src/components/shared/PrintKuitansiGabungan.tsx')

describe('receipt print layout contract', () => {
  it('uses the continuous-form paper size and a conservative printable width', () => {
    expect(css).toContain('size: 241mm 140mm')
    expect(css).toContain('width: 201mm !important')
    expect(single).toContain('max-w-[201mm]')
    expect(combined).toContain('max-w-[201mm]')
  })

  it('uses the official vertical foundation logo for printed receipts', () => {
    expect(branding).toContain('YAYASAN_PRINT_LOGO_URL = "/branding/yayasan-at-tauhid.png"')
    expect(single).toContain('src={YAYASAN_PRINT_LOGO_URL}')
    expect(combined).toContain('src={YAYASAN_PRINT_LOGO_URL}')
  })

  it('keeps the existing receipt font sizes while tightening only horizontal layout', () => {
    expect(single).toContain('text-[12pt] leading-[1.25]')
    expect(combined).toContain('text-[12pt] leading-[1.25]')
    expect(single).toContain('text-[12.5pt]')
    expect(combined).toContain('text-[12.5pt]')
  })
})
