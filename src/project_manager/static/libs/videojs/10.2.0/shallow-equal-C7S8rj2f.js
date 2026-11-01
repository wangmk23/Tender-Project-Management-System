//#region ../utils/dist/object/shallow-equal.js
const hasOwn = Object.prototype.hasOwnProperty;
/** Shallowly compares values, including own string and symbol keys. */
function shallowEqual(a, b) {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
	const keysA = Reflect.ownKeys(a);
	const keysB = Reflect.ownKeys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) if (!hasOwn.call(b, key) || !Object.is(a[key], b[key])) return false;
	return true;
}

//#endregion
export { shallowEqual as t };
//# sourceMappingURL=shallow-equal-C7S8rj2f.js.map