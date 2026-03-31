import ReactDOMServer from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ParserPage from './ParserPage'
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

describe('ParserPage', () => {
  it('renders the timeline, selected trace details, and session export control in the timeline header', () => {
    const html = ReactDOMServer.renderToString(
      <ParserPage
        availableTags={['copilot']}
        availableTypes={['ASSISTANT_MESSAGE']}
        draftSearch=""
        evaluationByTraceId={new Map()}
        overview={{ ASSISTANT_MESSAGE: 1 }}
        search=""
        onOpenExportDialog={() => {}}
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

    expect(html).toContain('Trace timeline')
    expect(html).toContain('Selected trace')
    expect(html).toContain('Trace payload')
    expect(html).toContain('Export session')
    expect(html).not.toContain('Export to MLflow')
  })
})
