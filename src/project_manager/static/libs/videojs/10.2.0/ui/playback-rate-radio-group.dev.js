/*! Video.js | https://videojs.org/help */
import { f as isUndefined } from "../predicate-3rF1m2uv.js";
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as resolveText$1 } from "../resolve-text-CQ6OnJ11.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { u as selectPlaybackRate } from "../selectors-B0umcXKn.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as resolveLabel } from "../resolve-label-DhVHkW_N.js";
import { s as playbackRateText, t as RadioOptionsController } from "../controller-BRhgo9lr.js";
import { t as MenuRadioGroupElement } from "../radio-group-D0Xggx8c.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/core/ui/playback-rate-radio-group/core.js
function formatPlaybackRate(rate) {
	return `${rate}×`;
}
/** @internal */
var PlaybackRateRadioGroupCore = class PlaybackRateRadioGroupCore {
	static defaultProps = {
		label: "",
		formatRate: formatPlaybackRate,
		disabled: false
	};
	state = createState({
		rate: 1,
		value: "1",
		options: [],
		disabled: true,
		hidden: true,
		availability: "unavailable",
		label: ""
	});
	#props = { ...PlaybackRateRadioGroupCore.defaultProps };
	#media = null;
	constructor(props) {
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, PlaybackRateRadioGroupCore.defaultProps);
	}
	getLabel(state) {
		const custom = resolveLabel(this.#props.label, state);
		if (custom !== void 0) return custom;
		return playbackRateText;
	}
	getLabelParams(_state) {}
	getRateLabel(rate) {
		return this.#props.formatRate(rate);
	}
	getRateValue(rate) {
		return String(rate);
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
		const availability = media.playbackRates.length > 0 ? "available" : "unavailable";
		this.state.patch({
			rate: media.playbackRate,
			value: this.getRateValue(media.playbackRate),
			options: media.playbackRates.map((rate) => ({
				rate,
				value: this.getRateValue(rate),
				label: this.getRateLabel(rate),
				disabled: false
			})),
			disabled: this.#props.disabled || media.playbackRates.length === 0,
			hidden: availability === "unavailable",
			availability
		});
		this.state.patch({ label: resolveText$1(this.getLabel(this.state.current)) });
		return this.state.current;
	}
	select(media, rate) {
		if (this.#props.disabled) return;
		if (!media.playbackRates.includes(rate)) return;
		media.setPlaybackRate(rate);
	}
	selectValue(media, value) {
		const rate = media.playbackRates.find((candidate) => this.getRateValue(candidate) === value);
		if (isUndefined(rate)) return;
		this.select(media, rate);
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/playback-rate-radio-group/data.js
/** @internal */
const PlaybackRateRadioGroupDataAttrs = {
	/** Current playback rate. */
	rate: "data-rate",
	/** Present when playback rate selection is disabled. */
	disabled: "data-disabled",
	/** Present when playback rate selection is unavailable. */
	hidden: "data-hidden",
	/** Indicates playback rate availability (`available` or `unavailable`). */
	availability: "data-availability"
};

//#endregion
//#region ../html/dist/dev/ui/playback-rate-radio-group/element.js
/**
* Menu radio group that generates a `<media-menu-radio-item>` per available playback rate and shares the selected label
* and availability with an enclosing menu. An optional `<template>` holding one `<media-menu-radio-item>` customizes
* each generated item.
*/
var PlaybackRateRadioGroupElement = class extends MenuRadioGroupElement {
	constructor(..._args) {
		super(..._args);
		this.disabled = false;
		this.formatRate = PlaybackRateRadioGroupCore.defaultProps.formatRate;
		this.#core = new PlaybackRateRadioGroupCore();
		this.#i18n = new I18nController(this, i18nContext);
		this.#mediaState = new PlayerController(this, playerContext, selectPlaybackRate);
		this.#options = new RadioOptionsController(this, {
			setItemAttributes: (item, option) => item.setAttribute("data-rate", option.value),
			onValueChange: (value) => {
				const media = this.#mediaState.value;
				if (media) this.#core.selectValue(media, value);
			}
		});
	}
	static {
		this.tagName = "media-playback-rate-radio-group";
	}
	static {
		this.properties = {
			...MenuRadioGroupElement.properties,
			disabled: { type: Boolean }
		};
	}
	#core;
	#i18n;
	#mediaState;
	#options;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		if (!this.#mediaState.value && this.#mediaState.displayName) logMissingFeature(this.localName, this.#mediaState.displayName);
	}
	update(changed) {
		const media = this.#mediaState.value;
		let state = null;
		if (media) {
			this.#core.setProps({
				formatRate: this.formatRate,
				disabled: this.disabled
			});
			this.#core.setMedia(media);
			state = this.#core.getState();
			this.applyDefaultAriaLabel(translateText(this.#core.getLabel(state), this.#i18n.value, this.#core.getLabelParams(state)));
			this.#options.sync(state, this.#i18n.value, this.#i18n.locale);
			this.publishMenuOptionState(state.disabled, state.hidden, state.availability);
		} else this.publishMenuOptionState(true, true, "unsupported");
		super.update(changed);
		if (state) applyStateDataAttrs(this, state, PlaybackRateRadioGroupDataAttrs);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/playback-rate-radio-group.js
safeDefine(PlaybackRateRadioGroupElement);

//#endregion
//# sourceMappingURL=playback-rate-radio-group.dev.js.map