import { f as isUndefined } from "./predicate-3rF1m2uv.js";

//#region ../utils/dist/object/defaults.js
/**
* Creates a new object with default values filled in for undefined properties.
*
* Only keys owned by `defaultValues` are read from `object`; any other key on `object` is ignored. Callers pass live
* DOM elements as `object`, and enumerating those would touch hundreds of inherited accessors such as `offsetWidth` and
* `innerHTML`, forcing style recalculation and layout on every call.
*
* @example
*   ```ts
*   const props = { label: undefined, disabled: true };
*   const defaultProps = { label: '', disabled: false };
*   defaults(props, defaultProps); // { label: '', disabled: true }
*   ```;
*
* @internal
*/
function defaults(object, defaultValues) {
	const result = { ...defaultValues };
	for (const key of Object.keys(defaultValues)) {
		const value = object[key];
		if (!isUndefined(value)) result[key] = value;
	}
	return result;
}

//#endregion
export { defaults as t };
//# sourceMappingURL=defaults-nT7MwJ_t.js.map