import { exportScale } from '../timeline-export'

describe('exportScale', () => {
  it('renders small charts at 2x', () => {
    expect(exportScale(1600, 900)).toBe(2)
  })

  it('keeps the canvas within the area limit for long, tall charts', () => {
    const scale = exportScale(8000, 1200)
    expect(8000 * scale * 1200 * scale).toBeLessThanOrEqual(16_000_000 + 1)
    expect(scale).toBeLessThan(2)
  })

  it('keeps the longest side within the side limit', () => {
    expect(20000 * exportScale(20000, 200)).toBeLessThanOrEqual(16_000)
  })
})
