/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { f as selectRemotePlayback } from "../selectors-B0umcXKn.js";
import { n as startText, r as stopText, t as connectingText } from "../cast-ChGlQi-k.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/core/ui/cast-button/core.js
/** @internal */
var CastButtonCore = class CastButtonCore {
	static defaultProps = {
		label: "",
		disabled: false
	};
	state = createState({
		connection: "disconnected",
		availability: "unsupported",
		disabled: true,
		hidden: true,
		label: ""
	});
	#props = { ...CastButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, CastButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		if (state.connection === "connected") return stopText;
		if (state.connection === "connecting") return connectingText;
		return startText;
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
		const availability = !!globalThis.chrome ? media.remotePlaybackAvailability : "unsupported";
		this.state.patch({
			connection: media.remotePlaybackState,
			availability,
			disabled: this.#props.disabled || availability !== "available",
			hidden: availability === "unsupported"
		});
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	async toggle(media) {
		this.setMedia(media);
		if (this.getState().disabled) return;
		return media.promptRemotePlayback();
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/cast-button/data.js
/** @internal */
const CastButtonDataAttrs = {
	/**
	* Current remote playback connection state.
	*
	* @see https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback/state
	*/
	connection: "data-cast-state",
	/**
	* Whether remote playback can be requested on this platform.
	*
	* @see https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback
	*/
	availability: "data-availability",
	/** Present when the button is non-interactive (mirrors `aria-disabled`). */
	disabled: "data-disabled",
	/** Present when the button is hidden because the feature is unsupported. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/cast-button/element.js
var CastButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.core = new CastButtonCore();
		this.stateAttrMap = CastButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectRemotePlayback);
	}
	static {
		this.tagName = "media-cast-button";
	}
	activate(state) {
		return this.core.toggle(state);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/cast-button.js
safeDefine(CastButtonElement);

//#endregion
//# sourceMappingURL=cast-button.dev.js.map