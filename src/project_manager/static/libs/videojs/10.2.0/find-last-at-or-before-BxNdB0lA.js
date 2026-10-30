//#region ../utils/dist/array/find-last-at-or-before.js
/** Finds the index of the last ordered item whose value is at or before the target, or `-1` if none exists. */
function findLastIndexAtOrBefore(items, value, getValue) {
	let low = 0;
	let high = items.length - 1;
	let index = -1;
	while (low <= high) {
		const mid = low + high >>> 1;
		if (getValue(items[mid]) <= value) {
			index = mid;
			low = mid + 1;
		} else high = mid - 1;
	}
	return index;
}
/**
* Finds the last ordered item whose value is at or before the target.
*
* @internal
*/
function findLastAtOrBefore(items, value, getValue) {
	const index = findLastIndexAtOrBefore(items, value, getValue);
	return index < 0 ? void 0 : items[index];
}

//#endregion
export { findLastIndexAtOrBefore as n, findLastAtOrBefore as t };
//# sourceMappingURL=find-last-at-or-before-BxNdB0lA.js.map