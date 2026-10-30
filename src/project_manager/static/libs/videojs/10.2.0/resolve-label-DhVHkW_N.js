import { i as isFunction } from "./predicate-3rF1m2uv.js";

//#region ../core/dist/dev/core/ui/utils/resolve-label.js
function resolveLabel(label, state) {
	if (isFunction(label)) return label(state) || void 0;
	return label || void 0;
}

//#endregion
export { resolveLabel as t };
//# sourceMappingURL=resolve-label-DhVHkW_N.js.map