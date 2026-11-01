import { a as isNil } from "./predicate-3rF1m2uv.js";

//#region ../media/dist/dev/core/types.js
/**
* Normalize a `crossorigin` value the way the element's IDL attribute reflects it: missing stays `null`,
* `use-credentials` in any ASCII case is itself, and everything else — the empty string and unknown keywords included —
* is `anonymous`. A custom element delivers the raw attribute string, so this is where author spelling is settled.
*
* @internal
*/
function toMediaCrossOrigin(value) {
	if (isNil(value)) return null;
	return value.toLowerCase() === "use-credentials" ? "use-credentials" : "anonymous";
}
/** @internal */
const MediaReadyState = {
	HAVE_NOTHING: 0,
	HAVE_METADATA: 1,
	HAVE_CURRENT_DATA: 2,
	HAVE_FUTURE_DATA: 3,
	HAVE_ENOUGH_DATA: 4
};
/**
* Named values of {@link MediaStreamType}.
*
* @internal
*/
const MediaStreamTypes = {
	ON_DEMAND: "on-demand",
	LIVE: "live",
	UNKNOWN: "unknown"
};

//#endregion
export { MediaStreamTypes as n, toMediaCrossOrigin as r, MediaReadyState as t };
//# sourceMappingURL=types-D8a85nGw.js.map