/*! Video.js | https://videojs.org/help */
import { i as isFunction } from "../predicate-3rF1m2uv.js";
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as selectControls } from "../selectors-B0umcXKn.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { n as POPUP_HOST_SELECTOR } from "../host-BJbdoUVc.js";
import { t as controlsContext } from "../context-xorj553w.js";

//#region ../core/dist/dev/core/ui/controls/core.js
/** @internal */
var ControlsCore = class ControlsCore {
	static defaultProps = { visibility: "auto" };
	#props = { ...ControlsCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, ControlsCore.defaultProps);
	}
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		const media = this.#media;
		if (!media) return this.#props.visibility === "always" ? {
			visible: true,
			userActive: true
		} : null;
		return {
			visible: this.#props.visibility === "always" || media.controlsVisible,
			userActive: media.userActive
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/controls/data.js
/** @internal */
const ControlsDataAttrs = {
	/** Present when controls are visible. */
	visible: "data-visible",
	/** Present when the user has recently interacted. */
	userActive: "data-user-active"
};

//#endregion
//#region ../html/dist/dev/ui/controls/element.js
/**
* Tracks controls visibility, reflects it as data attributes, and shares it with its descendant controls parts. Hiding
* the controls closes any popup open inside it.
*/
var ControlsElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.visibility = ControlsCore.defaultProps.visibility;
		this.#core = new ControlsCore();
		this.#mediaState = new PlayerController(this, playerContext, selectControls);
		this.#provider = new ContextProvider(this, { context: controlsContext });
		this.#visible = true;
	}
	static {
		this.tagName = "media-controls";
	}
	static {
		this.properties = { visibility: { type: String } };
	}
	#core;
	#mediaState;
	#provider;
	#visible;
	connectedCallback() {
		super.connectedCallback();
		if (this.visibility === "auto" && !this.#mediaState.value && this.#mediaState.displayName) logMissingFeature(this.localName, this.#mediaState.displayName);
	}
	update(_changed) {
		super.update(_changed);
		this.#core.setProps({ visibility: this.visibility });
		this.#core.setMedia(this.#mediaState.value ?? null);
		const state = this.#core.getState();
		if (!state) return;
		applyStateDataAttrs(this, state, ControlsDataAttrs);
		this.#provider.setValue({
			state,
			stateAttrMap: ControlsDataAttrs
		});
		const wasVisible = this.#visible;
		this.#visible = state.visible;
		if (wasVisible && !state.visible) this.#closeOwnedOverlays();
	}
	#closeOwnedOverlays() {
		for (const element of this.querySelectorAll(POPUP_HOST_SELECTOR)) {
			const host = element;
			if (!isFunction(host.close)) continue;
			host.close("imperative-action");
		}
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/controls.js
safeDefine(ControlsElement);

//#endregion
//# sourceMappingURL=controls.dev.js.map