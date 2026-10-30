/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as ThumbnailElement } from "../element-CguhnMsB.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../html/dist/dev/ui/slider/thumbnail.js
/**
* `<media-thumbnail>` whose `time` follows the slider pointer. Left empty, it draws an image of its own; supply an
* `<img>` child to compose overlays or loading indicators beside the image it controls.
*/
var SliderThumbnailElement = class extends ThumbnailElement {
	static {
		this.tagName = "media-slider-thumbnail";
	}
	#ctx = new ContextConsumer(this, {
		context: sliderContext,
		subscribe: true
	});
	update(changed) {
		const ctx = this.#ctx.value;
		if (ctx) this.time = ctx.pointerValue;
		super.update(changed);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/slider-thumbnail.js
safeDefine(SliderThumbnailElement);

//#endregion
//# sourceMappingURL=slider-thumbnail.dev.js.map