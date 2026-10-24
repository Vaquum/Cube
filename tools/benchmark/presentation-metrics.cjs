"use strict";
// Additional styled-DOM metric. No application marker decides visual completion.
const sorted = values => [...values].sort((a, b) => a - b);
const median = values => { const a = sorted(values); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };
const p95 = values => { const a = sorted(values); return a.length ? a[Math.ceil(a.length * .95) - 1] : null; };
const visible = (pose, px, alpha) => Boolean(pose && pose[5] > alpha && pose[7] > px && pose[8] > px);
function near(pose, target, px, alpha, angle) {
  if (!visible(target, px, alpha)) return !visible(pose, px, alpha);
  if (!pose) return false;
  const rotation = Math.abs(pose[6] - target[6]) % 360;
  return [1, 2, 3, 4, 7, 8].every(i => Math.abs(pose[i] - target[i]) <= px) &&
    Math.abs(pose[5] - target[5]) <= alpha && Math.min(rotation, 360 - rotation) <= angle;
}
function settledIndex(frames, predicate) {
  let first = frames.length;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (!predicate(frames[i])) break;
    first = i;
  }
  return first;
}
function analyze(trace, protocol) {
  const { frames } = trace, t = protocol.tolerances;
  const base = trace.ack?.at;
  const invalid = reason => ({ outcome: "inconclusive", reason, presentationMs: null });
  if (!Number.isFinite(base)) return invalid("Missing after-dispatch acknowledgment");
  if (trace.invalidReasons?.length) return invalid(trace.invalidReasons.join(", "));
  if (trace.truncated) return invalid("Trace cap reached");
  if (!trace.semantic?.changed) return { outcome: "no-change", reason: "No changed declared result", presentationMs: null };
  if (frames.length < protocol.minimumFinalFrames) return invalid("Insufficient frame samples");
  const last = frames.at(-1), final = new Map(last.poses.map(pose => [pose[0], pose]));
  const tail = frames.filter(frame => frame.at >= last.at - protocol.finalStabilityMs);
  if (last.at - base < protocol.captureMs || tail.length < protocol.minimumFinalFrames) return invalid("Censored observation window");
  const actors = [...final.keys()].filter(id => frames.some(frame => visible(frame.poses.find(p => p[0] === id), t.positionCssPx, t.opacity)));
  if (!actors.length) return invalid("No presented relevant actors");
  const matches = (frame, px, alpha, angle) => {
    const poses = new Map(frame.poses.map(pose => [pose[0], pose]));
    return actors.every(id => near(poses.get(id), final.get(id), px, alpha, angle));
  };
  if (!tail.every(frame => matches(frame, t.stablePositionCssPx, t.stableOpacity, t.stableRotationDeg))) return invalid("Final pose was not stable");
  const at = settledIndex(frames, frame => matches(frame, t.positionCssPx, t.opacity, t.rotationDeg));
  const marker = settledIndex(frames, frame => frame.marked === 0), css = settledIndex(frames, frame => frame.css === 0);
  const groups = new Map();
  for (const event of trace.channels ?? []) if (event.type === "spring") {
    const key = event.owner + ":" + event.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const presentationMs = Math.max(0, frames[at].at - base);
  return { outcome: "complete", presentationMs, excessMs: presentationMs - trace.springDuration,
    markerMs: marker < frames.length ? Math.max(0, frames[marker].at - base) : null,
    cssMs: css < frames.length ? Math.max(0, frames[css].at - base) : null,
    medianFrameMs: median(frames.slice(1).map((frame, i) => frame.at - frames[i].at)),
    actors: actors.length, channels: [...groups].map(([key, events]) => ({ key, starts: events.length,
      retargets: events.filter(e => e.before?.active).length, firstAt: events[0].at - base, lastAt: events.at(-1).at - base })) };
}
function noiseFloor(pairs) {
  if (pairs.length !== 5 || pairs.some(pair => pair.some(x => x.outcome !== "complete"))) return { outcome: "inconclusive", reason: "Five complete A/A pairs are required" };
  const differences = pairs.map(([a, b]) => Math.abs(a.presentationMs - b.presentationMs));
  const frame = median(pairs.flatMap(pair => pair.map(x => x.medianFrameMs)));
  return { outcome: "complete", pairs: pairs.length, absoluteDifferencesMs: differences,
    aaP95Ms: p95(differences), twoFramesMs: 2 * frame, floorMs: Math.max(p95(differences), 2 * frame) };
}
function improvement(pairs, floor, workReduction) {
  if (floor.outcome !== "complete" || pairs.length !== 5 || pairs.some(pair => pair.some(x => x.outcome !== "complete"))) return { outcome: "inconclusive" };
  const differences = pairs.map(([a, b]) => a.presentationMs - b.presentationMs), gain = median(differences);
  return { outcome: gain > floor.floorMs && differences.filter(x => x > 0).length >= 4 && workReduction ? "material-improvement" : "no-demonstrated-improvement",
    pairedDifferencesMs: differences, medianGainMs: gain, floorMs: floor.floorMs, workReduction };
}
module.exports = { analyze, noiseFloor, improvement, median, p95 };
