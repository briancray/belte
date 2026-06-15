/*
The inspector UI as one self-contained HTML document — no app bundle, no build
step, so the page renders standalone whatever the host app's toolchain. Data
paths are derived from location.pathname (root + `/surface` + `/events`) so the
page works under any mount and inherits any APP_URL base transparently.

Three tabs over one event stream: Logs (the live tail, default), Traces (records
grouped by trace id with a span waterfall), and Surface (the static catalog).
Everything is built client-side from the buffered records, so filters and the
waterfall need no extra server round-trips. Styling is inline (devtools-dark) —
it can't reach the app's Tailwind from here.
*/
export function inspectorHtml(appName: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(appName)} · belte inspector</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0c0d10; color: #d7dae0; }
  header { flex: none; display: flex; align-items: baseline; gap: 12px; padding: 10px 16px; border-bottom: 1px solid #1d2026; }
  header b { font-size: 14px; color: #fff; }
  header span { color: #6b7280; }
  header .warn { margin-left: auto; color: #d9a441; font-size: 11px; }
  nav { flex: none; display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid #1d2026; }
  nav button { background: none; border: none; border-bottom: 2px solid transparent; color: #6b7280; padding: 8px 12px; cursor: pointer; font: inherit; }
  nav button.active { color: #fff; border-bottom-color: #5b8def; }
  nav .count { color: #4b5563; font-size: 11px; }
  main { flex: 1; min-height: 0; }
  .panel { display: none; height: 100%; overflow: auto; }
  .panel.active { display: block; }

  .filters { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 8px 16px; background: #0c0d10; border-bottom: 1px solid #1d2026; }
  .filters select, .filters input { background: #14161b; border: 1px solid #1d2026; color: #d7dae0; border-radius: 4px; padding: 4px 8px; font: inherit; }
  .filters input { flex: 1; min-width: 60px; }
  .filters .pill { color: #6b7280; font-size: 11px; }
  .filters button { background: #14161b; border: 1px solid #1d2026; color: #9aa0aa; border-radius: 4px; padding: 4px 8px; cursor: pointer; font: inherit; }

  .row { display: flex; gap: 10px; align-items: baseline; padding: 3px 16px; border-bottom: 1px solid #14161b; font-variant-numeric: tabular-nums; }
  .row:hover { background: #111317; }
  .row.block { align-items: flex-start; }
  .trace { flex: none; width: 64px; color: #5b8def; cursor: pointer; }
  .trace:hover { text-decoration: underline; }
  .body { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.block .body { overflow: visible; white-space: normal; text-overflow: clip; }
  .body pre.msg { margin: 0; font: inherit; white-space: pre; overflow-x: auto; }
  .meta { flex: none; display: flex; gap: 8px; align-items: baseline; }
  .channel { color: #6b7280; }
  .sock { color: #b48ead; }
  .payload { color: #6b7280; }
  .method { font-weight: 700; }
  .method.GET { color: #5fb87a; } .method.POST { color: #5b8def; } .method.PUT, .method.PATCH { color: #d9a441; } .method.DELETE { color: #d96a6a; } .method.HEAD { color: #9aa0aa; }
  .status.s2 { color: #5fb87a; } .status.s3 { color: #56b6c2; } .status.s4 { color: #d9a441; } .status.s5 { color: #d96a6a; }
  .ms { color: #6b7280; }
  .cache { color: #56b6c2; font-size: 11px; }
  .lvl-error .body { color: #d96a6a; } .lvl-warn .body { color: #d9a441; }

  /* Each trace opens with a full-bleed banded header (accent top border) so a new
     trace is unmistakable when scrolling past a long multi-request one. */
  .twrap { padding: 0 16px 12px; }
  /* Sticky under the axis toolbar (top ≈ its height) so the current trace's header
     stays visible while scrolling its requests; toolbar z-index sits above it. */
  .thead { position: sticky; top: 46px; z-index: 1; display: flex; gap: 10px; align-items: baseline; cursor: pointer; background: #14161b; margin: 0 -16px 8px; padding: 8px 16px; border-top: 2px solid #34507e; }
  .thead:hover { background: #181c24; color: #fff; }
  /* Click a header to collapse its trace (open by default); the caret rotates to show state. */
  .tcaret { flex: none; width: 12px; color: #6b7280; transition: transform 0.12s; }
  .twrap.collapsed .tcaret { transform: rotate(-90deg); }
  .twrap.collapsed .thead { margin-bottom: 0; }
  .twrap.collapsed > :not(.thead) { display: none; }
  .tid { flex: none; width: 72px; color: #6f9bf2; font-weight: 700; }
  .tpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .span { display: grid; grid-template-columns: 220px 1fr; gap: 10px; align-items: center; margin-top: 4px; }
  /* Row highlight on hover so a thin bar stays trackable across the empty track. */
  .span:hover { background: #15181e; }
  .span:hover .track { background: #0e0f13; }
  .slabel { display: flex; gap: 6px; align-items: baseline; overflow: hidden; font-size: 12px; }
  .sname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa0aa; }
  /* Duration riding the bar: trailing the right edge, or right-tucked inside (.in) for near-full bars. */
  .bdur { position: absolute; top: 0; line-height: 14px; font-size: 11px; white-space: nowrap; padding-left: 4px; color: #9aa0aa; pointer-events: none; }
  .bdur.in { padding-left: 0; padding-right: 4px; color: #c5cad3; }
  /* Narrow bar at the right edge: dim label trailing to the left, off the bar. */
  .bdur.left { padding-left: 0; padding-right: 4px; }
  .track { position: relative; height: 14px; background: #07080a; border-radius: 3px; }
  .bar { position: absolute; top: 0; height: 100%; background: #3b5da8; border-radius: 3px; min-width: 2px; }
  .bar.req { background: #2d3b57; }
  /* The request header row: extra top gap separates requests; its path flexes + brightens. */
  .span.qrow { margin-top: 12px; }
  .qname { flex: 1; min-width: 0; color: #d7dae0; }

  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 16px 16px 8px; }
  table.surface { width: calc(100% - 32px); margin: 0 16px 16px; border-collapse: collapse; }
  table.surface th { text-align: left; font-weight: normal; color: #4b5563; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 4px 10px; border-bottom: 1px solid #1d2026; }
  table.surface td { padding: 4px 10px; border-bottom: 1px solid #14161b; white-space: nowrap; }
  table.surface th.c, table.surface td.c { text-align: center; }
  table.surface th.num, table.surface td.num { text-align: right; }
  tr.vrow { cursor: pointer; }
  tr.vrow:hover td { background: #111317; }
  td.url { color: #d7dae0; width: 99%; }
  .glyph.on { color: #5fb87a; } .glyph.off { color: #2b2f38; }
  .num { color: #9aa0aa; font-variant-numeric: tabular-nums; }
  tr.vdetail > td { background: #07080a; white-space: normal; }
  tr.vdetail dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 14px; margin: 4px 0 8px; max-width: 520px; }
  tr.vdetail dt { color: #6b7280; } tr.vdetail dd { margin: 0; color: #9aa0aa; }
  pre.schema { margin: 6px 0 0; padding: 8px; background: #0c0d10; border-radius: 4px; overflow: auto; color: #9aa0aa; white-space: pre; }
  .cval { max-width: 380px; overflow: hidden; text-overflow: ellipsis; color: #9aa0aa; }
  .cstat.settled { color: #5fb87a; } .cstat.in-flight { color: #d9a441; } .cstat.refreshing { color: #56b6c2; }
  .empty { color: #4b5563; padding: 16px; }
</style>
</head>
<body>
<header>
  <b>${escapeHtml(appName)}</b><span>belte inspector</span>
  <span class="warn">privileged · exposes all traffic</span>
</header>
<nav>
  <button data-tab="logs" class="active">Logs <span class="count" id="logsCount"></span></button>
  <button data-tab="traces">Traces <span class="count" id="tracesCount"></span></button>
  <button data-tab="cache">Cache <span class="count" id="cacheCount"></span></button>
  <button data-tab="surface">Surface</button>
</nav>
<main>
  <section class="panel active" data-tab="logs">
    <div class="filters">
      <select id="fChannel"><option value="">all channels</option></select>
      <input id="fTrace" placeholder="trace id…" />
      <input id="fText" placeholder="filter text…" />
      <span class="pill" id="fCount"></span>
      <button id="fClear">clear</button>
    </div>
    <div id="feed"><div class="empty">waiting for activity…</div></div>
  </section>
  <section class="panel" data-tab="traces">
    <div class="filters">
      <button id="traceAxis" title="normalized: each request fills its lane; clock: real wall-clock waterfall across the trace">axis: normalized</button>
    </div>
    <div id="traces"><div class="empty">no traces yet…</div></div>
  </section>
  <section class="panel" data-tab="cache"><div id="cache" class="empty">loading cache…</div></section>
  <section class="panel" data-tab="surface"><div id="surface" class="empty">loading surface…</div></section>
</main>
<script type="module">
const root = location.pathname.replace(/\\/$/, '')
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const stripAnsi = (s) => String(s).replace(/\\u001b\\[[0-9;]*m/g, '')

// ---- state ----
const RECORD_CAP = 4000
const ROW_CAP = 800
const records = []
const filters = { channel: '', trace: '', text: '' }
let activeTab = 'logs'
// 'normalized' = each request fills its own lane (relative shape); 'clock' = all
// requests laid on one shared wall-clock axis (real gaps + overlap across the trace).
let traceAxis = 'normalized'
// Trace ids the user collapsed — persisted across re-renders so a new record doesn't reopen them.
const collapsedTraces = new Set()

const feedEl = document.getElementById('feed')
const tracesEl = document.getElementById('traces')
const channelSel = document.getElementById('fChannel')
const seenChannels = new Set()

// The pseudo-channel a record filters under: its own channel, or 'request' for
// a closing request record, so requests are selectable alongside log channels.
const channelOf = (r) => r.channel || (r.status !== undefined ? 'request' : 'app')

function matches(r) {
  if (filters.channel && channelOf(r) !== filters.channel) return false
  if (filters.trace && !(r.trace || '').includes(filters.trace)) return false
  if (filters.text) {
    const hay = (r.msg || '') + ' ' + (r.path || '') + ' ' + (r.method || '') + ' ' + (r.data ? JSON.stringify(r.data) : '')
    if (!hay.toLowerCase().includes(filters.text.toLowerCase())) return false
  }
  return true
}

// ---- log rows ----
function rowEl(r) {
  const ms = r.elapsedMs ?? r.durationMs
  const isRequest = r.status !== undefined
  const isSocket = r.channel === 'socket'
  let body
  let block = false
  if (isRequest) {
    body = '<span class="method ' + esc(r.method || '') + '">' + esc(r.method || '') + '</span> ' + esc(r.path || '')
  } else if (isSocket) {
    const payload = r.data !== undefined ? JSON.stringify(r.data) : ''
    body = '<span class="sock">socket ' + esc(r.msg) + '</span> <span class="payload">' + esc(payload.slice(0, 120)) + '</span>'
  } else {
    block = true
    const tag = r.channel ? '<span class="channel">[' + esc(r.channel) + ']</span> ' : ''
    const extra = r.data !== undefined ? ' ' + JSON.stringify(r.data) : ''
    // Span records (log.trace) carry the operation in name with an empty msg;
    // show name + its own duration (an error span keeps msg), mirroring the console formatter.
    const span = r.name !== undefined && r.durationMs !== undefined
    const label = span
      ? r.name + ' ' + r.durationMs.toFixed(2) + 'ms' + (r.level === 'error' && r.msg ? ' ' + r.msg : '')
      : (r.msg || '')
    body = '<pre class="msg">' + tag + esc(stripAnsi(label) + extra) + '</pre>'
  }
  const cache = r.cache && (r.cache.hits + r.cache.misses + r.cache.coalesced) > 0
    ? '<span class="cache" title="cache hits/misses/coalesced">⚡ ' + r.cache.hits + '/' + r.cache.misses + '/' + r.cache.coalesced + '</span>'
    : ''
  const meta =
    (isRequest ? '<span class="status s' + String(r.status)[0] + '">' + esc(r.status) + '</span>' : '') +
    cache +
    (ms !== undefined ? '<span class="ms">+' + ms.toFixed(1) + 'ms</span>' : '')
  const row = document.createElement('div')
  row.className = 'row lvl-' + (r.level || 'info') + (block ? ' block' : '')
  row.innerHTML =
    '<span class="trace" data-trace="' + esc(r.trace || '') + '">' + esc((r.trace || '').slice(0, 8)) + '</span>' +
    '<span class="body">' + body + '</span>' +
    '<span class="meta">' + meta + '</span>'
  return row
}

function appendRow(r) {
  const scroller = document.querySelector('.panel[data-tab=logs]')
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
  feedEl.append(rowEl(r))
  while (feedEl.childElementCount > ROW_CAP) feedEl.firstElementChild.remove()
  if (atBottom) scroller.scrollTop = scroller.scrollHeight
}

function renderLogs() {
  feedEl.innerHTML = ''
  const shown = records.filter(matches)
  for (const r of shown.slice(-ROW_CAP)) feedEl.append(rowEl(r))
  document.getElementById('fCount').textContent = shown.length + ' / ' + records.length
  const scroller = document.querySelector('.panel[data-tab=logs]')
  scroller.scrollTop = scroller.scrollHeight
}

// ---- traces / waterfall ----
// A propagated trace holds many requests (a page session: the SSR render plus
// every RPC its interactions fired). Each request restarts elapsedMs at 0, so
// they can't share one axis — split a trace by request span, give each its own
// lane/axis, and nest by parent span (interactions descend from the page load).
function renderTraces() {
  const byTrace = new Map()
  for (const r of records) {
    if (!r.trace) continue
    if (!byTrace.has(r.trace)) byTrace.set(r.trace, [])
    byTrace.get(r.trace).push(r)
  }
  document.getElementById('tracesCount').textContent = byTrace.size || ''
  if (byTrace.size === 0) { tracesEl.innerHTML = '<div class="empty">no traces yet…</div>'; return }
  // Newest traces first, by the latest record's timestamp.
  const order = [...byTrace.entries()].sort((a, b) => last(b[1]).ts - last(a[1]).ts).slice(0, 200)
  tracesEl.innerHTML = order.map(([id, recs]) => traceHtml(id, recs)).join('')
}
const last = (a) => a[a.length - 1]

// The track + positioned bar at start/scale, width dur/scale (caller picks the axis:
// the request's own total, or the trace's shared wall-clock window). The duration
// label sits where it reads cleanly: trailing the bar's right edge when there's room,
// tucked inside a wide bar that ends near full, else trailing left of a narrow edge bar
// (never sitting on a thin bar, which read as a highlighted pill).
function barTrack(start, dur, scale, cls) {
  const left = (start / scale) * 100
  const width = Math.max((dur / scale) * 100, 0.4)
  const end = left + width
  const label = dur.toFixed(1) + 'ms'
  const LABEL_W = 5 // approx label width as % of track — room needed to trail without clipping
  const durEl =
    end + LABEL_W <= 100
      ? '<span class="bdur" style="left:' + end + '%">' + label + '</span>'
      : width >= 14
        ? '<span class="bdur in" style="right:' + (100 - end) + '%">' + label + '</span>'
        : '<span class="bdur left" style="right:' + (100 - left) + '%">' + label + '</span>'
  return (
    '<div class="track"><div class="bar ' + cls + '" style="left:' + left +
    '%;width:' + width + '%"></div>' + durEl + '</div>'
  )
}

// One span row: a truncating name, then the bar (the bar carries its duration).
function spanBar(start, dur, scale, cls, name) {
  return '<div class="span"><span class="slabel"><span class="sname">' + esc(name) +
    '</span></span>' + barTrack(start, dur, scale, cls) + '</div>'
}

// Reduce the records sharing a request span into one request: its root timing
// (the closing record) plus its operation spans, each placed on the request's
// own axis (elapsedMs is request-relative, so this is correct per request).
function buildRequest(span, recs) {
  const closing = recs.find((r) => r.status !== undefined)
  const total = Math.max(closing ? closing.durationMs : 0, ...recs.map((r) => r.elapsedMs || 0), 1)
  const spans = recs
    .filter((r) => r.name && r.durationMs !== undefined)
    .map((r) => ({ name: r.name, start: (r.elapsedMs ?? r.durationMs) - r.durationMs, dur: r.durationMs }))
    .sort((a, b) => a.start - b.start)
  // Wall-clock start (ms epoch): a record's emission ts minus its time-since-
  // request-start (the closing record's total, or any record's request-relative
  // elapsed). ts is the only clock shared across requests, so it anchors the
  // clock-axis waterfall; intra-request precision still comes from elapsedMs.
  const anchor = closing || recs.find((r) => r.elapsedMs !== undefined) || recs[0]
  const absStart = anchor
    ? anchor.ts - (closing ? closing.durationMs : anchor.elapsedMs || 0)
    : 0
  return {
    span,
    parent: recs[0] && recs[0].parentSpan,
    ts: recs[0] ? recs[0].ts : 0,
    method: (closing && closing.method) || (recs[0] && recs[0].method),
    path: (closing && closing.path) || (recs[0] && recs[0].path),
    status: closing ? closing.status : undefined,
    total,
    absStart,
    spans,
  }
}

function traceHtml(id, recs) {
  const byReq = new Map()
  for (const r of recs) {
    const span = r.requestSpan || 'none'
    if (!byReq.has(span)) byReq.set(span, [])
    byReq.get(span).push(r)
  }
  const requests = [...byReq.entries()].map(([span, rs]) => buildRequest(span, rs))
  const known = new Set(requests.map((q) => q.span))
  // Root = the request belte started the trace at (no parent); else the earliest.
  const byTs = [...requests].sort((a, b) => a.ts - b.ts)
  const root = byTs.find((q) => q.parent === undefined) || byTs[0]
  // A request nests under its parent when that parent is itself a request in this
  // trace (server→server); otherwise it descends from a client span we never saw,
  // so it hangs under the journey root (the page load).
  const childrenOf = (span) => requests.filter((q) =>
    q !== root && (known.has(q.parent) ? q.parent === span : span === root.span))
  const totalSpans = requests.reduce((n, q) => n + q.spans.length, 0)
  // Shared wall-clock window for the clock axis: earliest request start to latest end.
  const tStart = Math.min(...requests.map((q) => q.absStart))
  const tWindow = Math.max(...requests.map((q) => q.absStart + q.total)) - tStart || 1
  const head =
    '<div class="thead">' +
    '<span class="tcaret">▾</span>' +
    '<span class="tid">' + esc(id.slice(0, 8)) + '</span>' +
    '<span class="tpath">trace · ' + requests.length + ' request' + (requests.length === 1 ? '' : 's') +
      (traceAxis === 'clock' ? ' · ' + tWindow.toFixed(0) + 'ms wall' : '') + '</span>' +
    '<span class="channel">' + totalSpans + ' spans</span>' +
    '</div>'
  const collapsed = collapsedTraces.has(id) ? ' collapsed' : ''
  return '<div class="twrap' + collapsed + '" data-trace="' + esc(id) + '">' +
    head + requestHtml(root, childrenOf, 0, tStart, tWindow) + '</div>'
}

// One request lane + operation spans, then its child requests indented. On the
// normalized axis each request fills its own track (base 0, scaled to its total);
// on the clock axis bars sit on the shared trace window at their wall-clock offset.
function requestHtml(q, childrenOf, depth, tStart, tWindow) {
  if (!q || depth > 8) return ''
  const clock = traceAxis === 'clock'
  const base = clock ? q.absStart - tStart : 0
  const scale = clock ? tWindow : q.total
  const pad = 'style="padding-left:' + depth * 16 + 'px"'
  // The request header IS its own bar row: method/path/status in the label column,
  // the request track on the right — no separate "request" line restating the header.
  const status = q.status !== undefined
    ? '<span class="status s' + String(q.status)[0] + '">' + q.status + '</span>'
    : '<span class="ms">…</span>'
  const header =
    '<div class="span qrow" ' + pad + '>' +
    '<span class="slabel">' +
    '<span class="method ' + esc(q.method || '') + '">' + esc(q.method || '') + '</span>' +
    '<span class="sname qname">' + esc(q.path || q.span.slice(0, 8)) + '</span>' +
    status +
    '</span>' +
    barTrack(base, q.total, scale, 'req') +
    '</div>'
  // Spans restate the request's own verb+path; strip that noise. The handler reads
  // 'handle'; import/parse/validate drop the redundant path to just the op. A nested
  // in-process call (a different url) keeps its full name — there it's new info.
  const reqPath = (q.path || '').split('?')[0]
  const handlerName = 'rpc ' + (q.method || '') + ' ' + reqPath
  const shortName = (name) =>
    name === handlerName
      ? 'handle'
      : reqPath && name.endsWith(' ' + reqPath)
        ? name.slice(0, -(reqPath.length + 1))
        : name
  const bars = '<div ' + pad + '>' +
    q.spans.map((s) => spanBar(base + s.start, s.dur, scale, '', shortName(s.name))).join('') +
    '</div>'
  const kids = childrenOf(q.span).map((c) => requestHtml(c, childrenOf, depth + 1, tStart, tWindow)).join('')
  return header + bars + kids
}

// ---- ingest ----
let traceTimer
function ingest(r) {
  records.push(r)
  if (records.length > RECORD_CAP) records.shift()
  const ch = channelOf(r)
  if (!seenChannels.has(ch)) {
    seenChannels.add(ch)
    const opt = document.createElement('option')
    opt.value = ch; opt.textContent = ch
    channelSel.append(opt)
  }
  document.getElementById('logsCount').textContent = records.length
  if (activeTab === 'logs' && matches(r)) appendRow(r)
  if (activeTab === 'traces' && r.trace) {
    clearTimeout(traceTimer); traceTimer = setTimeout(renderTraces, 250)
  }
}

// ---- tabs + filters ----
for (const btn of document.querySelectorAll('nav button')) {
  btn.onclick = () => {
    activeTab = btn.dataset.tab
    for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b === btn)
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.dataset.tab === activeTab)
    if (activeTab === 'logs') renderLogs()
    if (activeTab === 'traces') renderTraces()
    if (activeTab === 'cache') loadCache()
  }
}
const traceAxisBtn = document.getElementById('traceAxis')
traceAxisBtn.onclick = () => {
  traceAxis = traceAxis === 'normalized' ? 'clock' : 'normalized'
  traceAxisBtn.textContent = 'axis: ' + traceAxis
  renderTraces()
}
channelSel.onchange = () => { filters.channel = channelSel.value; renderLogs() }
document.getElementById('fTrace').oninput = (e) => { filters.trace = e.target.value.trim(); renderLogs() }
document.getElementById('fText').oninput = (e) => { filters.text = e.target.value.trim(); renderLogs() }
document.getElementById('fClear').onclick = () => {
  filters.channel = ''; filters.trace = ''; filters.text = ''
  channelSel.value = ''; document.getElementById('fTrace').value = ''; document.getElementById('fText').value = ''
  renderLogs()
}
// Click a trace id to pivot: filter logs to it and switch to the Logs tab.
feedEl.addEventListener('click', (e) => {
  const t = e.target.closest('.trace')
  if (!t || !t.dataset.trace) return
  filters.trace = t.dataset.trace
  document.getElementById('fTrace').value = t.dataset.trace
  renderLogs()
})
// Click a trace header to collapse/expand its requests (open by default).
tracesEl.addEventListener('click', (e) => {
  const head = e.target.closest('.thead')
  if (!head) return
  const wrap = head.parentElement
  const collapsed = wrap.classList.toggle('collapsed')
  if (collapsed) collapsedTraces.add(wrap.dataset.trace)
  else collapsedTraces.delete(wrap.dataset.trace)
})

// ---- surface ----
const glyph = (on) => '<span class="glyph ' + (on ? 'on' : 'off') + '">' + (on ? '✓' : '·') + '</span>'
const fmtMs = (n) => n === undefined || n === null ? '·' : n + 'ms'
const fmtBytes = (n) => {
  if (n === undefined || n === null) return '·'
  if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + 'KB'
  return n + 'B'
}
const schemaBlock = (label, s) => s ? '<pre class="schema">' + esc(label + ': ' + JSON.stringify(s, null, 2)) + '</pre>' : ''

// One expandable verb: the columnar row (surfaces line up) + a hidden detail row
// with every declared option. A JS toggle, not <details>, so WebKit's flex-summary
// double-click bug can't apply.
function verbRow(v, i) {
  // Every option is a column now; expanding adds only the full schemas.
  const detail = v.inputSchema || v.outputSchema
    ? schemaBlock('input', v.inputSchema) + schemaBlock('output', v.outputSchema)
    : '<div class="empty">no schemas declared</div>'
  return (
    '<tr class="vrow" data-i="' + i + '">' +
    '<td><span class="method ' + esc(v.method) + '">' + esc(v.method) + '</span></td>' +
    '<td class="url">' + esc(v.url) + '</td>' +
    '<td class="c">' + glyph(!!v.inputSchema) + '</td>' +
    '<td class="c">' + glyph(v.clients.browser) + '</td>' +
    '<td class="c">' + glyph(v.clients.mcp) + '</td>' +
    '<td class="c">' + glyph(v.clients.cli) + '</td>' +
    '<td class="c">' + glyph(!!v.crossOrigin) + '</td>' +
    '<td class="c">' + glyph(v.files) + '</td>' +
    '<td class="num">' + fmtMs(v.timeout) + '</td>' +
    '<td class="num">' + fmtBytes(v.maxBodySize) + '</td>' +
    '</tr>' +
    '<tr class="vdetail" hidden><td colspan="10">' + detail + '</td></tr>'
  )
}

async function loadSurface() {
  const surfaceEl = document.getElementById('surface')
  try {
    const { verbs, sockets } = await (await fetch(root + '/surface')).json()
    // Registration order is arbitrary; sort by path (then method) so the catalog is scannable.
    const sortedVerbs = [...verbs].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method))
    const sortedSockets = [...sockets].sort((a, b) => a.name.localeCompare(b.name))
    const verbTable =
      '<table class="surface"><thead><tr>' +
      '<th>method</th><th>path</th><th class="c">schema</th><th class="c">browser</th>' +
      '<th class="c">mcp</th><th class="c">cli</th><th class="c">xorigin</th><th class="c">files</th>' +
      '<th class="num">timeout</th><th class="num">body</th>' +
      '</tr></thead><tbody>' + sortedVerbs.map(verbRow).join('') + '</tbody></table>'
    const socketTable = sockets.length
      ? '<table class="surface"><thead><tr><th>socket</th><th>operations</th><th>http</th></tr></thead><tbody>' +
        sortedSockets.map((s) =>
          '<tr><td class="url">' + esc(s.name) + '</td><td>' + esc(s.operations.map((o) => o.kind).join(' ')) + '</td>' +
          '<td><pre class="schema">' + esc(s.operations.map((o) => o.method + ' ' + o.httpUrl).join('\\n')) + '</pre></td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty">none</div>'
    surfaceEl.className = ''
    surfaceEl.innerHTML =
      '<h2>RPC verbs (' + verbs.length + ')</h2>' + verbTable +
      '<h2>Sockets (' + sockets.length + ')</h2>' + socketTable
    for (const row of surfaceEl.querySelectorAll('tr.vrow')) {
      row.onclick = () => {
        const detail = row.nextElementSibling
        if (detail && detail.classList.contains('vdetail')) detail.hidden = !detail.hidden
      }
    }
  } catch (e) {
    surfaceEl.innerHTML = '<div class="empty">surface failed: ' + esc(e.message) + '</div>'
  }
}

// ---- cache ----
// Snapshots the persistent (global) store; entries change over time, so it
// refreshes on tab open and via the refresh button (not a live stream).
const fmtTtl = (n) => n === undefined ? '∞' : n === 0 ? '0' : n + 'ms'
const fmtExpiry = (n) => n === undefined || n === null ? '·' : Math.max(0, n / 1000).toFixed(1) + 's'
async function loadCache() {
  const el = document.getElementById('cache')
  try {
    const { entries } = await (await fetch(root + '/cache')).json()
    document.getElementById('cacheCount').textContent = entries.length || ''
    const refresh = '<div class="filters"><span class="pill">' + entries.length +
      ' global ' + (entries.length === 1 ? 'entry' : 'entries') + '</span><button id="cacheRefresh">refresh</button></div>'
    if (!entries.length) {
      el.className = ''
      el.innerHTML = refresh + '<div class="empty">global store empty — entries come from cache(fn, { global: true }); request-scoped reads show as per-request tallies in Logs/Traces</div>'
    } else {
      const rows = entries.map((e) =>
        '<tr><td class="url">' + esc(e.key) + '</td>' +
        '<td class="cstat ' + esc(e.status) + '">' + esc(e.status) + '</td>' +
        '<td>' + (e.remote ? 'remote' : 'producer') + '</td>' +
        '<td class="num">' + fmtTtl(e.ttl) + '</td>' +
        '<td class="num">' + fmtExpiry(e.expiresInMs) + '</td>' +
        '<td>' + esc(e.scope.join(' ') || '·') + (e.policy ? ' <span class="channel">' + esc(e.policy) + '</span>' : '') + '</td>' +
        '<td class="cval">' + esc(e.value || '·') + '</td></tr>').join('')
      el.className = ''
      el.innerHTML = refresh +
        '<table class="surface"><thead><tr><th>key</th><th>status</th><th>kind</th>' +
        '<th class="num">ttl</th><th class="num">expires</th><th>scope</th><th>value</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    }
    document.getElementById('cacheRefresh').onclick = loadCache
  } catch (e) {
    el.innerHTML = '<div class="empty">cache failed: ' + esc(e.message) + '</div>'
  }
}

// ---- live feed ----
let first = true
const source = new EventSource(root + '/events')
source.onmessage = (event) => {
  if (first) { feedEl.innerHTML = ''; first = false }
  ingest(JSON.parse(event.data))
}

loadSurface()
</script>
</body>
</html>`
}

// Minimal HTML-attribute/text escaping for the values interpolated server-side.
function escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (character) => {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
    })
}
