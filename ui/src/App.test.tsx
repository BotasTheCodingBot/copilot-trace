import ReactDOMServer from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the workspace shell with lazy-page fallback', () => {
    const html = ReactDOMServer.renderToString(<App />)
    expect(html).toContain('Copilot Trace')
    expect(html).toContain('Workspace menu')
    expect(html).toContain('Parser overview')
    expect(html).toContain('Loading workspace')
    expect(html).toContain('Loading page component…')
  })
})
