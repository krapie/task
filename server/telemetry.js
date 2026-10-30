// RED metrics and the server span of task-api.
//
// http_server_request_duration_seconds{service,route,code} is served on its own port (the gateway never routes
// it; the node-local OTel collector scrapes it). Rate, errors and duration of a route all come from it, so the
// numbers stay exact however few traces are kept. The label is the Express route pattern ("/api/todos/:id"),
// never the raw path, so scanners cannot create series.
//
// Every request is also a span (method, route, status; no path or query). The trace gateway's tail sampling
// decides what Tempo keeps.

import http from 'node:http'
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import client from 'prom-client'

const METRICS_PORT = Number(process.env.METRICS_PORT || 9467) // ops 9464, operator 9465, auth 9466, task 9467

const registry = new client.Registry()
// 0.05 and 0.1 are the p95 targets of auth and task (docs/operations/slo.md, "Response time targets").
export const duration = new client.Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'HTTP server request duration by route pattern and status class.',
  labelNames: ['service', 'route', 'code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
})

export const statusClass = (s) => (s >= 500 ? '5xx' : s >= 400 ? '4xx' : s >= 300 ? '3xx' : '2xx')

const tracer = trace.getTracer('task')
const SKIP = new Set(['/api/health'])

export function telemetry(req, res, next) {
  if (SKIP.has(req.path)) return next()
  // Cloudflare adds a traceparent to some browser requests; only in-cluster callers join their trace.
  const parent = req.headers['cf-ray'] ? ROOT_CONTEXT : propagation.extract(ROOT_CONTEXT, req.headers)
  const span = tracer.startSpan(req.method, { kind: SpanKind.SERVER }, parent)
  const start = process.hrtime.bigint()
  res.on('close', () => {
    // A connection closed before the response finished is counted as a client error.
    const status = res.writableFinished ? res.statusCode : 499
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched'
    duration.labels('task', route, statusClass(status)).observe(Number(process.hrtime.bigint() - start) / 1e9)
    span.updateName(`${req.method} ${route}`)
    span.setAttributes({ 'http.request.method': req.method, 'http.route': route, 'http.response.status_code': status })
    if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
    span.end()
  })
  context.with(trace.setSpan(parent, span), next)
}

export function startMetricsServer() {
  http
    .createServer(async (req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': registry.contentType })
      res.end(await registry.metrics())
    })
    .listen(METRICS_PORT)
    .on('error', (err) => console.error('metrics server:', err.message))
}
