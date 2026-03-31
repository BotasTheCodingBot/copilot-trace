import ReactDOMServer from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App, { describePickedDirectory, parseBundleTags, supportsNativeDirectoryPicker } from './App'

describe('App', () => {
  it('renders the workspace shell with lazy-page fallback', () => {
    const html = ReactDOMServer.renderToString(<App />)
    expect(html).toContain('Copilot Trace')
    expect(html).toContain('Workspace menu')
    expect(html).toContain('Parser overview')
    expect(html).toContain('Loading workspace')
    expect(html).toContain('Loading page component…')
  })

  it('parses export tags from mixed separators', () => {
    expect(parseBundleTags('owner=tore, env=local\ninvalid\nempty=')).toEqual({ owner: 'tore', env: 'local' })
  })

  it('detects directory picker support only when showDirectoryPicker exists', () => {
    expect(supportsNativeDirectoryPicker(undefined)).toBe(false)
    expect(supportsNativeDirectoryPicker({ showDirectoryPicker: async () => ({}) })).toBe(true)
  })

  it('prefers an absolute path from native directory handles when available', () => {
    expect(describePickedDirectory({ name: 'exports', path: '/tmp/exports' })).toEqual({ label: 'exports', path: '/tmp/exports' })
    expect(describePickedDirectory({ name: 'exports' })).toEqual({ label: 'exports', path: '' })
  })
})
