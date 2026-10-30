//#region ../html/dist/dev/registration/safe-define.js
/**
* Define a custom element only if not already registered.
*
* `tagName` overrides the element's own, for the rare case of registering one element under a second name — two flavors
* of the same element in one runtime, say, where whichever registers first would otherwise take the name and the other
* would silently lose it. Registering under the override does not change `element.tagName`, so anything reading the
* class still sees its standard name.
*/
function safeDefine(element, tagName = element.tagName) {
	const registry = globalThis.customElements;
	if (!registry || registry.get(tagName)) return;
	registry.define(tagName, element);
}

//#endregion
export { safeDefine as t };
//# sourceMappingURL=safe-define-THEasJ9B.js.map