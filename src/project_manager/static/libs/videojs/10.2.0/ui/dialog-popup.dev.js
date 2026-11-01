/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";
import { t as ContextPartElement } from "../context-part-element-CFayL4cg.js";

//#region ../html/dist/dev/ui/dialog/popup.js
/** Semantic popup that owns focus management and dialog transition completion. */
var DialogPopupElement = class extends ContextPartElement {
	constructor(..._args) {
		super(..._args);
		this.consumer = new ContextConsumer(this, {
			context: dialogContext,
			subscribe: true
		});
		this.#dialog = null;
	}
	static {
		this.tagName = "media-dialog-popup";
	}
	#dialog;
	disconnectedCallback() {
		this.#dialog?.setPopupElement(null);
		this.#dialog = null;
		super.disconnectedCallback();
	}
	update(changed) {
		super.update(changed);
		const ctx = this.consumer.value;
		if (!ctx) return;
		if (this.#dialog !== ctx.dialog) {
			this.#dialog?.setPopupElement(null);
			this.#dialog = ctx.dialog;
			this.#dialog.setPopupElement(this);
		}
		applyElementProps(this, {
			id: ctx.popupId,
			tabIndex: -1,
			...ctx.popupAttrs
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/dialog-popup.js
safeDefine(DialogPopupElement);

//#endregion
//# sourceMappingURL=dialog-popup.dev.js.map