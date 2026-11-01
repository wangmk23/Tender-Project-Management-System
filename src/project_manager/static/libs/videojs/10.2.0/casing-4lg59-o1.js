//#region ../utils/dist/string/casing.js
/** @internal */
function pascalCase(str) {
	return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toUpperCase());
}
/** @internal */
function camelCase(str) {
	return pascalCase(str).replace(/^(.)/, (_, c) => c.toLowerCase());
}
/** @internal */
function kebabCase(str) {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
/** @internal */
function snakeCase(str) {
	return str.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

//#endregion
export { kebabCase as n, snakeCase as r, camelCase as t };
//# sourceMappingURL=casing-4lg59-o1.js.map