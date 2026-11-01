//#region ../utils/dist/number/number.js
/**
* Clamp a value between min and max (inclusive).
*
* @internal
*/
function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
/**
* Convert a value within a range to a clamped percentage (0–100).
*
* @param value - Value to convert.
* @param min - Start of the range.
* @param max - End of the range.
* @internal
*/
function toPercent(value, min, max) {
	const range = max - min;
	if (!Number.isFinite(range) || range <= 0) return 0;
	return clamp((value - min) / range * 100, 0, 100);
}
/**
* Snap a value to the nearest step, offset from min.
*
* @internal
*/
function roundToStep(value, step, min) {
	const nearest = Math.round((value - min) / step) * step + min;
	const dot = `${step}`.indexOf(".");
	return dot === -1 ? nearest : Number(nearest.toFixed(`${step}`.length - dot - 1));
}

//#endregion
export { roundToStep as n, toPercent as r, clamp as t };
//# sourceMappingURL=number-D2skb7-A.js.map