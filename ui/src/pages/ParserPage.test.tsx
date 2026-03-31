import ReactDOMServer from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ParserPage, { parseMlflowTags } from './ParserPage'
import type { Trace } from '../types'

const trace: Trace = {
  id: 'trace-1',
  session_id: 'session-1',
  timestamp: '2026-03-31T10:00:00Z',
  type: 'ASSISTANT_MESSAGE',
  function: 'assistant.reply',
  text: 'hello world',
  tags: ['copilot'],
}

describe('parseMlflowTags', () => {
  it('parses key value tags from new lines and commas', () => {
    expect(parseMlflowTags('env=local, team=ai\nowner=tore\ninvalid\nempty='))
      .toEqual({ env: 'local', team: 'ai', owner: 'tore' })
  })
})

describe('ParserPage', () => {
  it('renders MLflow export action for the selected trace panel', () => {
    const html = ReactDOMServer.renderToString(
      <ParserPage
        availableTags={['copilot']}
        availableTypes={['ASSISTANT_MESSAGE']}
        draftSearch=""
        evaluationByTraceId={new Map()}
        overview={{ ASSISTANT_MESSAGE: 1 }}
        search=""
        selectedSession="session-1"
        selectedTag="all"
        selectedTrace={trace}
        selectedType="all"
        setDraftSearch={() => {}}
        setSearch={() => {}}
        setSelectedTag={() => {}}
        setSelectedTraceId={() => {}}
        setSelectedType={() => {}}
        setTracePage={() => {}}
        setTraceSort={() => {}}
        tracePage={1}
        traceSort="asc"
        traces={[trace]}
        tracesTotal={1}
      />,
    )

    expect(html).toContain('Export to MLflow')
    expect(html).toContain('Selected trace')
    expect(html).toContain('Trace payload')
  })
})
