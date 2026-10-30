//#region ../core/dist/dev/dom/utils/state-data-attrs.js
/**
* Apply state as data attributes to an element.
*
* - `true` → sets `data-keyname=""`
* - Truthy string/number → sets `data-keyname="value"`
* - Falsy → removes the attribute
*
* @example
*   ```ts
*   const state = { paused: true, ended: false };
*   applyStateDataAttrs(element, state);
*   // element has data-paused="", data-ended is removed
*   ```;
*
* @internal
*/
function applyStateDataAttrs(element, state, map) {
	for (const key in state) {
		if (map && !(key in map)) continue;
		const name = map?.[key] ?? toDataAttrName(key), value = state[key];
		if (value === true) element.setAttribute(name, "");
		else if (value) element.setAttribute(name, String(value));
		else element.removeAttribute(name);
	}
}
function toDataAttrName(key) {
	return `data-${key.toLowerCase()}`;
}

//#endregion
export { applyStateDataAttrs as t };
//# sourceMappingURL=state-data-attrs-DiSfe3GX.js.map