/**
 * Utilities for consistent wheel-based zoom interactions.
 * Normalizes wheel deltas across devices and produces smooth exponential scaling.
 */

export interface WheelZoomEventLike {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;

function normalizeWheelDelta({ deltaX, deltaY, deltaMode = 0 }: WheelZoomEventLike): number {
  const dominantDelta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;

  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return dominantDelta * LINE_HEIGHT_PX;
    case DOM_DELTA_PAGE:
      return dominantDelta * PAGE_HEIGHT_PX;
    default:
      return dominantDelta;
  }
}

export interface ZoomMultiplierOptions {
  intensity?: number;
  maxMagnitude?: number;
}

/**
 * Convert a wheel event into an exponential zoom multiplier.
 * Values > 1 zoom in, values < 1 zoom out.
 */
export function getWheelZoomMultiplier(
  event: WheelZoomEventLike,
  { intensity = 0.0006, maxMagnitude = 600 }: ZoomMultiplierOptions = {}
): number {
  const normalized = normalizeWheelDelta(event);
  const clamped = Math.max(-maxMagnitude, Math.min(maxMagnitude, normalized));

  return Math.exp(-clamped * intensity);
}

