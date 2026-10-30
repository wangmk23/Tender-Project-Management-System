/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";

//#region ../html/dist/dev/ui/dialog/backdrop.js
/** Presentational backdrop that reflects its owning dialog's state. */
var DialogBackdropElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: dialogContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-dialog-backdrop";
	}
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("role", "presentation");
		this.setAttribute("aria-hidden", "true");
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/dialog-backdrop.js
safeDefine(DialogBackdropElement);

//#endregion
//# sourceMappingURL=dialog-backdrop.dev.js.map