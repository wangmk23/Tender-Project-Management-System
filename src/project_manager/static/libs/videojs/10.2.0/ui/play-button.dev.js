/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { l as selectPlayback } from "../selectors-B0umcXKn.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { i as replayText, n as pauseText, r as playText } from "../buttons-B8Ei5CJ5.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/core/ui/play-button/core.js
/** @internal */
var PlayButtonCore = class PlayButtonCore {
	static defaultProps = {
		label: "",
		disabled: false
	};
	state = createState({
		paused: true,
		ended: false,
		started: false,
		label: ""
	});
	#props = { ...PlayButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, PlayButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		if (state.ended) return replayText;
		return state.paused ? playText : pauseText;
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
		this.state.patch({
			paused: media.paused,
			ended: media.ended,
			started: media.started
		});
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	async toggle(media) {
		if (this.#props.disabled) return;
		if (media.paused || media.ended) return media.play();
		media.pause();
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/play-button/data.js
/** @internal */
const PlayButtonDataAttrs = {
	/** Present when the media is paused. */
	paused: "data-paused",
	/** Present when the media has ended. */
	ended: "data-ended",
	/** Present when playback has started. */
	started: "data-started"
};

//#endregion
//#region ../html/dist/dev/ui/play-button/element.js
var PlayButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.core = new PlayButtonCore();
		this.stateAttrMap = PlayButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectPlayback);
		this.hotkeyAction = "togglePaused";
	}
	static {
		this.tagName = "media-play-button";
	}
	activate(state) {
		return this.core.toggle(state);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/play-button.js
safeDefine(PlayButtonElement);

//#endregion
//# sourceMappingURL=play-button.dev.js.map