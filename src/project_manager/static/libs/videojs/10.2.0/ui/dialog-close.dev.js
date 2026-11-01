/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { t as createButton } from "../button-BpO-7OFK.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as dialogContext } from "../context-CjiW7_2k.js";

//#region ../html/dist/dev/ui/dialog/close.js
/** Button that closes its owning dialog; the element itself takes `role="button"` and keyboard focus. */
var DialogCloseElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.disabled = false;
		this.#ctx = new ContextConsumer(this, {
			context: dialogContext,
			subscribe: true
		});
		this.#disconnect = null;
	}
	static {
		this.tagName = "media-dialog-close";
	}
	static {
		this.properties = { disabled: { type: Boolean } };
	}
	#ctx;
	#disconnect;
	connectedCallback() {
		super.connectedCallback();
		this.#disconnect = new AbortController();
		const buttonProps = createButton({
			onActivate: () => this.#ctx.value?.close(),
			isDisabled: () => this.disabled
		});
		applyElementProps(this, buttonProps, { signal: this.#disconnect.signal });
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	update(_changed) {
		super.update(_changed);
		const ctx = this.#ctx.value;
		if (ctx) applyStateDataAttrs(this, ctx.state, ctx.stateAttrMap);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/dialog-close.js
safeDefine(DialogCloseElement);

//#endregion
//# sourceMappingURL=dialog-close.dev.js.map