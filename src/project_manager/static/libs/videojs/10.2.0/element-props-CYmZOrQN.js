import { f as isUndefined, i as isFunction } from "./predicate-3rF1m2uv.js";
import { t as listen } from "./listen-CO63BggB.js";

//#region ../core/dist/dev/dom/utils/element-props.js
/**
* Apply props to a DOM element.
*
* Handles both attributes and event listeners: - Event props (onClick, onKeyDown, etc.) are attached as listeners -
* Event props ending in `Capture` use capture phase, except pointer capture events - Boolean props: `true` sets empty
* attribute, `false` removes - `undefined` removes the attribute - Other props are set as string attributes
*
* @internal
*/
function applyElementProps(element, props, options) {
	const signal = options?.signal;
	for (const [key, value] of Object.entries(props)) if (isFunction(value) && key.startsWith("on")) {
		const capture = key.endsWith("Capture") && !key.endsWith("PointerCapture");
		const event = key.slice(2, capture ? -7 : void 0).toLowerCase();
		listen(element, event, value, signal ? {
			capture,
			signal
		} : { capture });
	} else if (isUndefined(value) || value === false) element.removeAttribute(key);
	else if (value === true) element.setAttribute(key, "");
	else element.setAttribute(key, String(value));
}

//#endregion
export { applyElementProps as t };
//# sourceMappingURL=element-props-CYmZOrQN.js.map