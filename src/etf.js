/* ETF report contract and timeline. Pure helpers shared by the page and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.explorerEtf = api;
})(typeof globalThis === "undefined" ? globalThis : this, function () {
  const finite = v => typeof v === "number" && Number.isFinite(v), nullable = v => v === null || finite(v);
  function parse(body, want) {
    if (!body || body.schema !== "cube-etf@1" || body.scaleUsd !== 1e9 || body.from !== want.from || body.to !== want.to || body.asOf !== want.as_of
      || !body.source || typeof body.source.state !== "string" || !body.snapshot || !Array.isArray(body.states) || body.states.length > 20000) throw new Error("Invalid ETF response");
    let previous = -Infinity;
    for (const r of body.states) {
      if (!Number.isSafeInteger(r.knownAt) || r.knownAt < 0 || r.knownAt <= previous || r.knownAt >= Math.min(want.to, want.as_of)
        || typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.complete !== "boolean"
        || !Number.isInteger(r.expected) || r.expected < 1 || r.expected > 30 || !Number.isInteger(r.reported) || r.reported < 0 || r.reported > r.expected
        || ![r.inflow,r.outflow,r.net,r.magnitude,r.normal].every(nullable) || !Array.isArray(r.funds) || r.funds.length !== r.expected
        || r.funds.some(f => typeof f.ticker !== "string" || f.ticker.length > 15 || !nullable(f.net))
        || new Set(r.funds.map(f => f.ticker)).size !== r.expected || !Number.isInteger(r.normalReports) || r.normalReports < 0 || r.normalReports > 20
        || (r.normal !== null && (r.normal < 0 || r.normalReports !== 20))) throw new Error("Invalid ETF report");
      const known=r.funds.filter(f=>f.net!==null), positive=known.reduce((s,f)=>s+Math.max(0,f.net),0),negative=known.reduce((s,f)=>s+Math.max(0,-f.net),0);
      if (known.length!==r.reported || (known.length ? r.inflow===null || r.outflow===null || Math.abs(r.inflow-positive)>.01 || Math.abs(r.outflow-negative)>.01 : r.inflow!==null || r.outflow!==null)) throw new Error("Invalid ETF fund coverage");
      if (r.complete ? ![r.inflow,r.outflow,r.net,r.magnitude].every(finite) || r.inflow < 0 || r.outflow < 0 || r.reported !== r.expected
        || Math.abs(r.net-(r.inflow-r.outflow)) > .01 || Math.abs(r.magnitude-(r.inflow+r.outflow)) > .01
        : r.net !== null || r.magnitude !== null) throw new Error("Invalid ETF amounts");
      previous = r.knownAt;
    }
    return body;
  }
  function at(body, time, edge = Infinity) {
    if (!body || time < body.from || time >= Math.min(body.to, body.asOf, edge)) return null;
    let lo=0,hi=body.states.length;
    while(lo<hi){const m=(lo+hi)>>1;if(body.states[m].knownAt<=time && body.states[m].knownAt<edge)lo=m+1;else hi=m;}
    return body.states[lo-1] ?? null;
  }
  function spans(body, from, to, edge) {
    const stop=Math.min(to,edge), cuts=[...(body?.states ?? []).filter(r=>r.knownAt>=body.from).map(r=>r.knownAt), ...(body ? [body.from,Math.min(body.to,body.asOf)] : [])],
      boundaries=[from,...[...new Set(cuts.filter(t=>t>from&&t<stop))].sort((a,b)=>a-b),stop];
    return stop<=from?[]:boundaries.slice(0,-1).map((t,i)=>({from:t,to:boundaries[i+1],report:at(body,t,edge)}));
  }
  const covers = (body, want) => Boolean(body) && body.from <= want.from && body.to >= want.to && Math.min(body.asOf, body.to) >= Math.min(want.as_of, want.to);
  const y = (value, middle, half, limit=1e9) => middle-Math.max(-1,Math.min(1,value/limit))*half;
  return Object.freeze({parse,at,spans,covers,y});
});
