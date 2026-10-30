//#region ../core/dist/dev/dom/utils/log.js
const warned = /* @__PURE__ */ new Set();
/** @internal */
function logMissingFeature(displayName, featureName) {
	const key = `${displayName}:${featureName}`;
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(`${displayName} requires ${featureName} feature`);
}

//#endregion
export { logMissingFeature as t };
//# sourceMappingURL=log-DrTPNK96.js.map