//#region ../utils/dist/dom/supports.js
/** @internal */
function supportsAnchorPositioning() {
	return typeof CSS !== "undefined" && CSS.supports("anchor-name: --a");
}
/** @internal */
function supportsPopoverAPI() {
	return typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
}
/**
* Whether `new CSSStyleSheet()` works. Safari exposed the interface long before 16.4 made it constructable, and
* constructing it there throws `TypeError: Illegal constructor`, so checking for the interface is not enough.
*
* @internal
*/
function supportsConstructableStyleSheets() {
	if (typeof globalThis.CSSStyleSheet === "undefined") return false;
	try {
		new globalThis.CSSStyleSheet();
		return true;
	} catch {
		return false;
	}
}

//#endregion
export { supportsConstructableStyleSheets as n, supportsPopoverAPI as r, supportsAnchorPositioning as t };
//# sourceMappingURL=supports-DoLag2tA.js.map