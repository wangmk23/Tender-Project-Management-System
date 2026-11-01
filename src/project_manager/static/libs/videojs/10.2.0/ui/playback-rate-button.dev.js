/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { u as selectPlaybackRate } from "../selectors-B0umcXKn.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { t as rateText } from "../playback-DeBAVfsg.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/core/ui/playback-rate-button/core.js
/** @internal */
var PlaybackRateButtonCore = class PlaybackRateButtonCore {
	static defaultProps = {
		label: "",
		disabled: false,
		menuTrigger: false
	};
	state = createState({
		rate: 1,
		label: ""
	});
	#props = { ...PlaybackRateButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, PlaybackRateButtonCore.defaultProps);
	}
	getLabel(state) {
		const custom = resolveLabel(this.#props.label, state);
		if (custom !== void 0) return custom;
		return rateText;
	}
	getLabelParams(state) {
		if (resolveLabel(this.#props.label, state) !== void 0) return void 0;
		return { rate: state.rate };
	}
	getAttrs(state) {
		return {
			"aria-label": this.getLabel(state),
			"aria-disabled": this.#props.disabled ? "true" : void 0
		};
	}
	setMedia(media) {
		this.#media = media;
	}
	getState() {
		const media = this.#media;
		this.state.patch({ rate: media.playbackRate });
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	cycle(media) {
		if (this.#props.disabled) return;
		if (this.#props.menuTrigger) return;
		const { playbackRates, playbackRate } = media;
		if (playbackRates.length === 0) return;
		const idx = playbackRates.indexOf(playbackRate);
		const next = idx === -1 ? playbackRates.find((r) => r > playbackRate) ?? playbackRates[0] : playbackRates[(idx + 1) % playbackRates.length];
		media.setPlaybackRate(next);
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/playback-rate-button/data.js
/** @internal */
const PlaybackRateButtonDataAttrs = { 
/** Current playback rate. */
rate: "data-rate" };

//#endregion
//#region ../html/dist/dev/ui/playback-rate-button/element.js
var PlaybackRateButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.commandfor = void 0;
		this.core = new PlaybackRateButtonCore();
		this.stateAttrMap = PlaybackRateButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectPlaybackRate);
		this.hotkeyAction = "speedUp";
	}
	static {
		this.tagName = "media-playback-rate-button";
	}
	static {
		this.properties = {
			label: { type: String },
			disabled: { type: Boolean },
			commandfor: { type: String }
		};
	}
	activate(state, event) {
		if (this.commandfor) {
			if (event instanceof KeyboardEvent) this.click();
			return;
		}
		this.core.cycle(state);
	}
	getIsButtonDisabled() {
		const media = this.mediaState.value;
		if (super.getIsButtonDisabled()) return true;
		if (this.commandfor && media && media.playbackRates.length === 0) return true;
		return false;
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		if (changed.has("commandfor")) {
			if (this.commandfor) this.setAttribute("commandfor", this.commandfor);
			else this.removeAttribute("commandfor");
		}
	}
	update(changed) {
		super.update(changed);
		if (!this.mediaState.value || !this.commandfor) return;
		applyElementProps(this, { "aria-disabled": this.getIsButtonDisabled() ? "true" : void 0 });
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/playback-rate-button.js
safeDefine(PlaybackRateButtonElement);

//#endregion
//# sourceMappingURL=playback-rate-button.dev.js.map