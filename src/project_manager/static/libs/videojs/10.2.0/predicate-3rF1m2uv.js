//#region ../utils/dist/predicate/predicate.js
/** @internal */
function isString(value) {
	return typeof value === "string";
}
/** @internal */
function isNumber(value) {
	return typeof value === "number";
}
/** @internal */
function isBoolean(value) {
	return typeof value === "boolean";
}
/** @internal */
function isFunction(value) {
	return typeof value === "function";
}
/** @internal */
function isNull(value) {
	return value === null;
}
/** @internal */
function isUndefined(value) {
	return typeof value === "undefined";
}
/** @internal */
function isNil(value) {
	return value == null;
}
/** @internal */
function isPromise(value) {
	return value instanceof Promise;
}
/**
* Check if a value is an object, excluding null.
*
* @internal
*/
function isObject(value) {
	return value !== null && typeof value === "object";
}
/**
* Check if a value is an object carrying a callable method for every given name.
*
* Recognizes a foreign object by the shape a caller needs from it, without importing the library that defines it or
* testing against its class.
*
* @internal
*/
function hasMethods(value, methods) {
	if (!isObject(value)) return false;
	return methods.every((method) => isFunction(value[method]));
}
/**
* Check if a value is a plain object (not a class instance like Date, Map, etc).
*
* @internal
*/
function isPlainObject(value) {
	if (!isObject(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === null || proto === Object.prototype;
}
/**
* Check if a value is an AbortError.
*
* @internal
*/
function isAbortError(value) {
	return value instanceof Error && value.name === "AbortError";
}

//#endregion
export { isNil as a, isObject as c, isString as d, isUndefined as f, isFunction as i, isPlainObject as l, isAbortError as n, isNull as o, isBoolean as r, isNumber as s, hasMethods as t, isPromise as u };
//# sourceMappingURL=predicate-3rF1m2uv.js.map