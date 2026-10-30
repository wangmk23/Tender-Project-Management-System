//#region ../spf/dist/dev/media/primitives/resolution.js
/**
* Apply `scale` to a size and normalize it to whole pixels, or `undefined` where that leaves nothing to describe.
*
* Rounded because pixels are whole and a fractional scale doesn't divide a surface evenly. A non-positive or non-finite
* axis yields `undefined` rather than a zero-area reading: an element that isn't being rendered reports `0 × 0` and a
* nonsense dimension reports `NaN`, and the caps consuming this read absence as "unknown, don't cap" while an area of
* zero would read as a cap of zero — pinning every source to its smallest rendition.
*
* @param size - Dimensions to project, in the units `scale` converts from
* @param scale - Multiplier for both axes, e.g. `devicePixelRatio`; defaults to 1
* @returns The scaled, whole-pixel resolution, or `undefined` when either axis
* doesn't survive it
*/
function scaleResolution(size, scale = 1) {
	const width = Math.round(size.width * scale);
	const height = Math.round(size.height * scale);
	return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? {
		width,
		height
	} : void 0;
}

//#endregion
export { scaleResolution as t };
//# sourceMappingURL=resolution-B0j7Y6Nv.js.map