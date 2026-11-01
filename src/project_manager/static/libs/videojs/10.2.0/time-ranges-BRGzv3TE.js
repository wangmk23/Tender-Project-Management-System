//#region ../media/dist/dev/dom/utils/time-ranges.js
/**
* A `TimeRanges`-shaped object holding a single range. Embed hosts only ever know one contiguous buffered or seekable
* span, so they report it through this rather than constructing a real `TimeRanges`, which has no public constructor.
*
* @internal
*/
function createTimeRange(start, end) {
	return {
		length: 1,
		start: () => start,
		end: () => end
	};
}

//#endregion
export { createTimeRange as t };
//# sourceMappingURL=time-ranges-BRGzv3TE.js.map