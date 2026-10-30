/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { l as selectPlayback } from "../selectors-B0umcXKn.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";

//#region ../core/dist/dev/core/ui/buffering-indicator/core.js
/** @internal */
var BufferingIndicatorCore = class BufferingIndicatorCore {
	static defaultProps = { delay: 500 };
	state = createState({ visible: false });
	#props = { ...BufferingIndicatorCore.defaultProps };
	#timer = null;
	setProps(props) {
		this.#props = defaults(props, BufferingIndicatorCore.defaultProps);
	}
	destroy() {
		this.#clearTimer();
	}
	update(media) {
		const buffering = media.waiting && !media.paused;
		if (buffering && !this.state.current.visible && !this.#timer) this.#timer = setTimeout(() => {
			this.#timer = null;
			this.state.patch({ visible: true });
		}, this.#props.delay);
		else if (!buffering) {
			this.#clearTimer();
			this.state.patch({ visible: false });
		}
	}
	#clearTimer() {
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/buffering-indicator/data.js
/** @internal */
const BufferingIndicatorDataAttrs = { 
/** Present when the buffering indicator is visible (after delay). */
visible: "data-visible" };

//#endregion
//#region ../html/dist/dev/ui/buffering-indicator/element.js
var BufferingIndicatorElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.delay = BufferingIndicatorCore.defaultProps.delay;
		this.#core = new BufferingIndicatorCore();
		this.#state = new PlayerController(this, playerContext, selectPlayback);
		this.#disconnect = null;
	}
	static {
		this.tagName = "media-buffering-indicator";
	}
	static {
		this.properties = { delay: { type: Number } };
	}
	#core;
	#state;
	#disconnect;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#disconnect = new AbortController();
		this.#core.state.subscribe(() => this.requestUpdate(), { signal: this.#disconnect.signal });
		if (!this.#state.value) logMissingFeature(this.localName, this.#state.displayName);
	}
	disconnectedCallback() {
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#core.destroy();
		super.destroyCallback();
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		this.#core.setProps(this);
	}
	update(changed) {
		super.update(changed);
		const media = this.#state.value;
		if (!media) return;
		this.#core.update(media);
		applyStateDataAttrs(this, this.#core.state.current, BufferingIndicatorDataAttrs);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/buffering-indicator.js
safeDefine(BufferingIndicatorElement);

//#endregion
//# sourceMappingURL=buffering-indicator.dev.js.map