/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText } from "../resolve-text-CQ6OnJ11.js";
import { r as isCaptionOrSubtitleTrack } from "../text-track-CnWDzah_.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { p as selectTextTrack } from "../selectors-B0umcXKn.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { t as MediaButtonElement } from "../media-button-element-C2m_z2c8.js";

//#region ../core/dist/dev/i18n/text/captions.js
const prefix = "captions.";
const enableText = {
	key: `${prefix}enable`,
	text: "Enable captions"
};
const disableText = {
	key: `${prefix}disable`,
	text: "Disable captions"
};

//#endregion
//#region ../core/dist/dev/core/ui/captions-button/core.js
/** @internal */
var CaptionsButtonCore = class CaptionsButtonCore {
	static defaultProps = {
		label: "",
		disabled: false,
		menuTrigger: false
	};
	state = createState({
		subtitlesShowing: false,
		availability: "unavailable",
		disabled: true,
		hidden: true,
		label: ""
	});
	#props = { ...CaptionsButtonCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, CaptionsButtonCore.defaultProps);
	}
	getLabel(state) {
		const label = resolveLabel(this.#props.label, state);
		if (label) return label;
		return state.subtitlesShowing ? disableText : enableText;
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
		const availability = media.textTrackList.some(isCaptionOrSubtitleTrack) ? "available" : "unavailable";
		this.state.patch({
			subtitlesShowing: media.subtitlesShowing,
			availability,
			disabled: this.#props.disabled || availability !== "available",
			hidden: availability === "unavailable"
		});
		this.state.patch({ label: resolveText(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	toggle(media) {
		this.setMedia(media);
		if (this.getState().disabled) return;
		if (this.#props.menuTrigger && getCaptionTrackCount$1(media) > 1) return;
		media.toggleSubtitles();
	}
};
function getCaptionTrackCount$1(media) {
	return media.textTrackList.filter(isCaptionOrSubtitleTrack).length;
}

//#endregion
//#region ../core/dist/dev/core/ui/captions-button/data.js
/** @internal */
const CaptionsButtonDataAttrs = {
	/** Present when captions are enabled. */
	subtitlesShowing: "data-active",
	/** Indicates captions availability (`available` or `unavailable`). */
	availability: "data-availability",
	/** Present when the button is non-interactive (mirrors `aria-disabled`). */
	disabled: "data-disabled",
	/** Present when the button is hidden because no caption tracks are present. */
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/command-for.js
/** Toggle a popup host linked via `commandfor` (menu, popover, etc.). */
function toggleCommandTarget(host, commandfor) {
	const root = host.getRootNode();
	const target = ("getElementById" in root ? root.getElementById(commandfor) : null) ?? root.querySelector(`#${CSS.escape(commandfor)}`);
	if (!target || !("open" in target)) return;
	const popup = target;
	popup.open = !popup.open;
}

//#endregion
//#region ../html/dist/dev/ui/captions-button/element.js
function getCaptionTrackCount(state) {
	return state.textTrackList.filter(isCaptionOrSubtitleTrack).length;
}
var CaptionsButtonElement = class extends MediaButtonElement {
	constructor(..._args) {
		super(..._args);
		this.commandfor = void 0;
		this.menuFor = void 0;
		this.#defaultCommandfor = void 0;
		this.core = new CaptionsButtonCore();
		this.stateAttrMap = CaptionsButtonDataAttrs;
		this.mediaState = new PlayerController(this, playerContext, selectTextTrack);
		this.hotkeyAction = "toggleSubtitles";
	}
	static {
		this.tagName = "media-captions-button";
	}
	static {
		this.properties = {
			label: { type: String },
			disabled: { type: Boolean },
			commandfor: { type: String },
			menuFor: {
				type: String,
				attribute: "menu-for"
			}
		};
	}
	#defaultCommandfor;
	connectedCallback() {
		super.connectedCallback();
		if (this.commandfor && this.commandfor !== this.menuFor) this.#defaultCommandfor = this.commandfor;
	}
	activate(state, event) {
		if (this.menuFor && getCaptionTrackCount(state) > 1) {
			if (event instanceof KeyboardEvent) toggleCommandTarget(this, this.menuFor);
			return;
		}
		this.core.toggle(state);
	}
	getIsButtonDisabled() {
		const media = this.mediaState.value;
		if (super.getIsButtonDisabled()) return true;
		if (media && getCaptionTrackCount(media) === 0) return true;
		return false;
	}
	willUpdate(changed) {
		super.willUpdate(changed);
		if (changed.has("commandfor") && this.commandfor !== this.menuFor) this.#defaultCommandfor = this.commandfor;
		if (changed.has("commandfor") || changed.has("menuFor")) this.#syncCommandFor();
	}
	update(changed) {
		super.update(changed);
		const media = this.mediaState.value;
		if (!media) return;
		this.#syncCommandFor(media);
		if (this.menuFor && getCaptionTrackCount(media) > 1) applyElementProps(this, { "aria-disabled": this.getIsButtonDisabled() ? "true" : void 0 });
	}
	#syncCommandFor(media) {
		const state = media ?? this.mediaState.value;
		const target = state && this.menuFor && getCaptionTrackCount(state) > 1 ? this.menuFor : this.#defaultCommandfor;
		if (target) this.setAttribute("commandfor", target);
		else this.removeAttribute("commandfor");
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/captions-button.js
safeDefine(CaptionsButtonElement);

//#endregion
//# sourceMappingURL=captions-button.dev.js.map