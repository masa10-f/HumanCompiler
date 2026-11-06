import {
  buildCalendarAxis,
  createTimeScale,
  fitText,
  routeDependencyLink,
  startOfJstDay,
  startOfJstWeek,
} from '../geometry'

describe('JST calendar helpers', () => {
  it('snaps to the start of the JST day', () => {
    // 2026-11-05T20:00Z is 11/6 05:00 JST
    expect(new Date(startOfJstDay(Date.parse('2026-11-05T20:00:00Z'))).toISOString()).toBe(
      '2026-11-05T15:00:00.000Z',
    )
  })

  it('snaps to Monday of the JST week', () => {
    // Friday 2026-11-06 JST → Monday 2026-11-02 JST
    expect(new Date(startOfJstWeek(Date.parse('2026-11-06T03:00:00Z'))).toISOString()).toBe(
      '2026-11-01T15:00:00.000Z',
    )
  })
})

describe('createTimeScale / buildCalendarAxis', () => {
  const extent = {
    start: new Date('2026-11-06T00:00:00Z'),
    end: new Date('2026-12-20T00:00:00Z'),
  }

  it('maps dates linearly to pixels', () => {
    const scale = createTimeScale(extent, 10, 'week', { leadDays: 0, tailDays: 0 })
    expect(scale.x(scale.start)).toBe(0)
    expect(scale.x(scale.start + 86_400_000 * 3)).toBe(30)
  })

  it('creates month bands and weekly ticks', () => {
    const scale = createTimeScale(extent, 10, 'week')
    const axis = buildCalendarAxis(scale, 'week')
    expect(axis.bands.map((band) => band.label)).toEqual(['2026年10月', '2026年11月', '2026年12月', '2027年1月'])
    expect(axis.ticks[0]!.label).toBe('10/26')
    expect(axis.ticks.every((tick) => tick.width === 70)).toBe(true)
  })

  it('marks weekends in the day view', () => {
    const scale = createTimeScale(extent, 30, 'day')
    const axis = buildCalendarAxis(scale, 'day')
    const saturday = axis.ticks.find((tick) => tick.sublabel === '土')
    expect(saturday?.isWeekend).toBe(true)
    expect(axis.weekends.length).toBeGreaterThan(0)
  })

  it('expands to the requested minimum width', () => {
    const scale = createTimeScale(extent, 2, 'month', { minWidth: 1200 })
    expect(scale.width).toBeGreaterThanOrEqual(1200)
  })
})

describe('routeDependencyLink', () => {
  it('drops down and enters from the left when the successor starts later', () => {
    const d = routeDependencyLink(
      {
        from: { startX: 0, endX: 100, edgeY: 34 },
        to: { startX: 200, centerY: 72, edgeY: 62 },
        gapY: 54,
      },
      { radius: 0 },
    )
    expect(d).toBe('M 94 34 L 94 72 L 200 72')
  })

  it('enters from the top when work is back to back', () => {
    const d = routeDependencyLink(
      {
        from: { startX: 0, endX: 100, edgeY: 34 },
        to: { startX: 100, centerY: 72, edgeY: 62 },
        gapY: 54,
      },
      { radius: 0 },
    )
    expect(d).toBe('M 94 34 L 94 54 L 108 54 L 108 62')
  })

  it('rounds the corners', () => {
    const d = routeDependencyLink({
      from: { startX: 0, endX: 100, edgeY: 34 },
      to: { startX: 200, centerY: 72, edgeY: 62 },
      gapY: 54,
    })
    expect(d).toContain('Q')
  })
})

describe('fitText', () => {
  it('keeps short text and truncates long text with an ellipsis', () => {
    expect(fitText('短い', 100, 12)).toBe('短い')
    const result = fitText('とても長いゴールのタイトルがここに入ります', 80, 12)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThan(12)
  })
})
