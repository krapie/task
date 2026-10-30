// OpenTelemetry bootstrap, loaded before the app: `node --import ./server/tracing.js server/index.js`
// (the instrumentations patch http and pg, so they must be registered before those modules are used).
//
// Spans go over OTLP/HTTP to the trace gateway (env OTEL_EXPORTER_OTLP_TRACES_ENDPOINT; unset = off), whose tail
// sampling decides what Tempo keeps. Outgoing http calls (operator, finance, mail-bridge) carry the W3C trace
// context, so one request is one trace across services. The server span and the RED histogram are in
// telemetry.js. Spans never keep a query string, SQL text or parameters: Sanitize removes them before export.

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

const URL_KEYS = ['url.full', 'http.url', 'http.target', 'url.query', 'url.path']
const SQL_KEYS = ['db.statement', 'db.query.text', 'db.query.summary']

// Drops what could carry a secret or user data from a finished span (attributes are plain, mutable objects).
export function sanitize(span) {
  const a = span.attributes
  for (const k of URL_KEYS) {
    if (typeof a[k] === 'string') a[k] = a[k].split('?')[0]
  }
  delete a['url.query']
  for (const k of SQL_KEYS) delete a[k]
  return span
}

class Sanitize {
  constructor(next) {
    this.next = next
  }
  onStart(span, ctx) {
    this.next.onStart(span, ctx)
  }
  onEnd(span) {
    this.next.onEnd(sanitize(span))
  }
  forceFlush() {
    return this.next.forceFlush()
  }
  shutdown() {
    return this.next.shutdown()
  }
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
if (endpoint) {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'task' }),
    spanProcessors: [new Sanitize(new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })))],
  })
  provider.register()
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Only calls the app makes: the server span is made by telemetry.js (route pattern, no raw path).
      new HttpInstrumentation({ ignoreIncomingRequestHook: () => true, requireParentforOutgoingSpans: true }),
      new PgInstrumentation({ requireParentSpan: true }),
    ],
  })
  // A pod stop flushes the last spans; with a handler installed the process must exit by itself.
  process.once('SIGTERM', () => {
    provider.shutdown().finally(() => process.exit(0))
  })
  console.log(`tracing: exporting to ${endpoint}`)
}
