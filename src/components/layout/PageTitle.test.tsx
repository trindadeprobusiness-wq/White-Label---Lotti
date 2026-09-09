import { describe, expect, it } from 'vitest'
import { PageTitle } from './PageTitle'

describe('PageTitle', () => {
  it('uses the Clientes, Imóveis and Funil title hierarchy', () => {
    const element = PageTitle({ children: 'Financeiro' })

    expect(element.type).toBe('h1')
    expect(element.props.className).toContain('text-2xl')
    expect(element.props.className).toContain('font-semibold')
    expect(element.props.className).toContain('tracking-tight')
  })

  it('keeps an optional icon aligned with the title', () => {
    const icon = <span data-testid="icon" />
    const element = PageTitle({ children: 'Mídias', icon })

    expect(element.props.className).toContain('flex')
    expect(element.props.children).toEqual([icon, 'Mídias'])
  })
})
