// A canvas callback cannot answer a control event while that canvas is hidden.
// Navigation uses the canvas witness; control and level-key actions use frame boundaries.
export function inputSamples(action, canvas, controls) {
  const samples = action === 'navigate' ? canvas : controls;
  if (!Array.isArray(samples) || !samples.length || samples.some(value => !Number.isFinite(value) || value < 0))
    throw new Error('Missing or invalid action-specific input latency samples');
  return samples;
}
