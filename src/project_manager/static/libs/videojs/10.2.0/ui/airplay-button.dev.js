/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { n as supportsWebKitAirPlay } from "../webkit-DXmoZ2Wz.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { f as selectRemotePlayback } from "../selectors-B0umcXKn.js";
import { t as connectingText } from "../cast-ChGlQi-k.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/i18n/text/airplay.js
const prefix = "airplay.";
const startText = {
	key: `${prefix}start`,
	text: "Start AirPlay"
};
const stopText = {
	key: `${prefix}stop`,
	text: "Stop AirPlay"
};

//#endregion
//#region ../core/dist/dev/core/ui/airplay-button/core.js
/** @internal */
var AirPlayButtonCore = class AirPlayButtonCore {
	static defaultProps = {
		label: "",
		disabled: false
	};
	state = createState({
		state: "disconnected",
		availability: "unsupported",
		disabled: true,
		hidden: true,
		label: ""
	});
	#props = { ...AirPlayButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, AirPlayButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		if (state.state === "connected") return stopText;
		if (state.state === "connecting") return connectingText;
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
		const availability = supportsWebKitAirPlay() ? media.remotePlaybackAvailability : "unsupported";
		this.state.patch({
			state: media.remotePlaybackState,
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
		try {
			await media.promptRemotePlayback();
		} catch {}
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/airplay-button/data.js
/** @internal */
const AirPlayButtonDataAttrs = {
	/**
	* Current AirPlay connection state.
	*
	* @see https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback/state
	*/
	state: "data-airplay-state",
	/**
	* Whether AirPlay is available on the active platform and media.
	*
	* @see https://developer.mozilla.org/en-US/docs/Web/API/RemotePlayback
	*/
	availability: "data-availability",
	/** Present when the button is non-interactive (mirrors `aria-disabled`). */
	disabled: "data-disabled",
	/** Present when the button is hidden because AirPlay is unavailable. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/airplay-button/element.js
var AirPlayButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.core = new AirPlayButtonCore();
		this.stateAttrMap = AirPlayButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectRemotePlayback);
	}
	static {
		this.tagName = "media-airplay-button";
	}
	activate(state) {
		return this.core.toggle(state);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/airplay-button.js
safeDefine(AirPlayButtonElement);

//#endregion
//# sourceMappingURL=airplay-button.dev.js.map