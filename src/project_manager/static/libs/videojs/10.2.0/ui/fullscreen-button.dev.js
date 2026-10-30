/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext, t as containerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { a as selectFullscreen } from "../selectors-B0umcXKn.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { n as exitText, t as enterText } from "../fullscreen-D5y_lZYB.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/core/ui/fullscreen-button/core.js
/** @internal */
var FullscreenButtonCore = class FullscreenButtonCore {
	static defaultProps = {
		label: "",
		disabled: false
	};
	state = createState({
		fullscreen: false,
		availability: "unavailable",
		disabled: true,
		hidden: true,
		label: ""
	});
	#props = { ...FullscreenButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, FullscreenButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		return state.fullscreen ? exitText : enterText;
	}
	getAttrs(state) {
		return {
			"aria-label": this.getLabel(state),
			"aria-disabled": state.disabled ? "true" : void 0,
			hidden: state.hidden ? "" : void 0
		};
	}
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		const media = this.#media;
		const availability = media.fullscreenAvailability;
		this.state.patch({
			fullscreen: media.isFullscreen,
			availability,
			disabled: this.#props.disabled || availability !== "available",
			hidden: availability !== "available"
		});
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	async toggle(media) {
		this.setMedia(media);
		if (this.getState().disabled) return;
		return media.isFullscreen ? media.exitFullscreen() : media.requestFullscreen();
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/fullscreen-button/data.js
/** @internal */
const FullscreenButtonDataAttrs = {
	/** Present when fullscreen mode is active. */
	fullscreen: "data-fullscreen",
	/** Indicates fullscreen availability (`available`, `unavailable`, `unsupported`). */
	availability: "data-availability",
	/** Present when the button is non-interactive (mirrors `aria-disabled`). */
	disabled: "data-disabled",
	/** Present when the button is hidden because fullscreen is not available. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/fullscreen-button/element.js
var FullscreenButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.core = new FullscreenButtonCore();
		this.stateAttrMap = FullscreenButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectFullscreen);
		this.hotkeyAction = "toggleFullscreen";
		this.#container = new ContextConsumer(this, {
			context: containerContext,
			subscribe: true
		});
	}
	static {
		this.tagName = "media-fullscreen-button";
	}
	#container;
	activate(state, _event, source) {
		if (source === "pointer") this.#container.value?.container?.focus({ preventScroll: true });
		return this.core.toggle(state);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/fullscreen-button.js
safeDefine(FullscreenButtonElement);

//#endregion
//# sourceMappingURL=fullscreen-button.dev.js.map