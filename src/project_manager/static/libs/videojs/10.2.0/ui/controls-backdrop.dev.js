/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";
import { t as controlsContext } from "../context-xorj553w.js";

//#region ../html/dist/dev/ui/controls/backdrop.js
/** Presentational backdrop that reflects its owning controls surface's state. */
var ControlsBackdropElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: controlsContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-controls-backdrop";
	}
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("role", "presentation");
		this.setAttribute("aria-hidden", "true");
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/controls-backdrop.js
safeDefine(ControlsBackdropElement);

//#endregion
//# sourceMappingURL=controls-backdrop.dev.js.map