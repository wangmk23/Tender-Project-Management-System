//#region ../utils/dist/dom/predicates.js
/** @internal */
function isDocument(value) {
	return value instanceof Node && value.nodeType === 9;
}
/** @internal */
function isShadowRoot(value) {
	return value instanceof Node && value.nodeType === 11 && "host" in value;
}
/** @internal */
function isHTMLImageElement(value) {
	return value instanceof HTMLImageElement;
}

//#endregion
export { isHTMLImageElement as n, isShadowRoot as r, isDocument as t };
//# sourceMappingURL=predicates-C_TReuAB.js.map