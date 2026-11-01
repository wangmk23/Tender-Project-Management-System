//#region ../utils/dist/string/escape-html.js
/** @internal */
function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/`/g, "&#96;");
}

//#endregion
//#region ../utils/dist/dom/attributes.js
/**
* Capture authored values for the selected attributes.
*
* @internal
*/
function snapshotAttributes(element, names) {
	return [...names].map((name) => ({
		name,
		value: element.getAttribute(name)
	}));
}
/**
* Restore a snapshot created by `snapshotAttributes`.
*
* @internal
*/
function restoreAttributes(element, snapshot) {
	for (const { name, value } of snapshot) if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}
/**
* Convert a NamedNodeMap to a plain object.
*
* @internal
*/
function namedNodeMapToObject(namedNodeMap) {
	const obj = {};
	for (const attr of namedNodeMap) obj[attr.name] = attr.value;
	return obj;
}
/**
* Helper function to serialize attributes into a string.
*
* @internal
*/
function serializeAttributes(attrs) {
	let html = "";
	for (const key in attrs) {
		const value = attrs[key];
		if (value === "") html += ` ${key}`;
		else html += ` ${key}="${escapeHtml(value)}"`;
	}
	return html;
}

//#endregion
export { escapeHtml as a, snapshotAttributes as i, restoreAttributes as n, serializeAttributes as r, namedNodeMapToObject as t };
//# sourceMappingURL=attributes-CI6LN9fK.js.map