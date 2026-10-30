import { t as UIElement } from "./ui-element--3_7he7k.js";
import { t as applyStateDataAttrs } from "./state-data-attrs-DiSfe3GX.js";

//#region ../html/dist/dev/ui/context-part-element.js
/**
* Abstract base for compound-component part elements that consume a parent context and apply data attributes from
* `ctx.state` + `ctx.stateAttrMap`.
*
* Subclasses only need to declare the `consumer` property:
*
* ```ts
* export class SliderTrackElement extends ContextPartElement<SliderState> {
*   static readonly tagName = 'media-slider-track';
*   protected readonly consumer = new ContextConsumer(this, { context: sliderContext, subscribe: true });
* }
* ```
*/
var ContextPartElement = class extends UIElement {
	connectedCallback() {
		super.connectedCallback();
		this.#applyState();
	}
	update(_changed) {
		super.update(_changed);
		this.#applyState();
	}
	#applyState() {
		const ctx = this.consumer.value;
		if (ctx) applyStateDataAttrs(this, ctx.state, ctx.stateAttrMap);
	}
};

//#endregion
export { ContextPartElement as t };
//# sourceMappingURL=context-part-element-CFayL4cg.js.map