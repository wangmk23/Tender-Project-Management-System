//#region ../utils/dist/object/pick.js
/**
* Creates a new object with only the specified keys.
*
* @example
*   const obj = { a: 1, b: 2, c: 3 };
*   pick(obj, ['a', 'c']); // { a: 1, c: 3 }
*
* @internal
*/
function pick(obj, keys) {
	const result = {};
	for (const key of keys) if (Object.hasOwn(obj, key)) result[key] = obj[key];
	return result;
}

//#endregion
export { pick as t };
//# sourceMappingURL=pick-BAh7WYWl.js.map