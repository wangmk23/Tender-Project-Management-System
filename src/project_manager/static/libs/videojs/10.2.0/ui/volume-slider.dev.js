/*! Video.js | https://videojs.org/help */
import { s as isNumber } from "../predicate-3rF1m2uv.js";
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as applyStyles } from "../style-CFppx62l.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { n as SliderCore, r as createSlider, t as SliderDataAttrs } from "../data-BgILZtly.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { h as selectVolume, r as selectControls } from "../selectors-B0umcXKn.js";
import { t as clamp } from "../number-D2skb7-A.js";
import { t as getSliderCSSVars } from "../css-vars-CBwz-Iu0.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { r as mutedValueText, t as labelText } from "../volume-DQ178W9h.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/dom/ui/wheel-step.js
/** @internal */
function createWheelStep(options) {
	return { onWheel(event) {
		if (options.isDisabled()) return;
		const direction = Math.sign(event.deltaY);
		if (direction === 0) return;
		event.preventDefault();
		const stepPercent = options.getStepPercent();
		const currentPercent = options.getPercent();
		const newPercent = clamp(currentPercent - direction * stepPercent, 0, 100);
		options.onValueChange?.(newPercent);
	} };
}

//#endregion
//#region ../utils/dist/percent/percent.js
const formatters = /* @__PURE__ */ new Map();
function localeCacheKey(locale) {
	if (locale === void 0) return "";
	return Array.isArray(locale) ? locale.join(":") : locale;
}
function getFormatter(locale) {
	const key = localeCacheKey(locale);
	let formatter = formatters.get(key);
	if (!formatter) try {
		formatter = new Intl.NumberFormat(locale, {
			style: "percent",
			maximumFractionDigits: 0
		});
		formatters.set(key, formatter);
	} catch {
		return;
	}
	return formatter;
}
function formatFallback(fraction) {
	return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
/**
* Format a fraction (0-1) with {@link Intl.NumberFormat} `style: "percent"`.
*
* @internal
*/
function formatPercent(fraction, locale) {
	const value = !isNumber(fraction) || !Number.isFinite(fraction) ? 0 : Math.min(1, Math.max(0, fraction));
	try {
		const formatter = getFormatter(locale) ?? getFormatter(void 0);
		if (formatter) return formatter.format(value);
	} catch {}
	return formatFallback(value);
}

//#endregion
//#region ../core/dist/dev/core/ui/volume-slider/core.js
/**
* Volume-domain slider: maps media volume/mute state to slider state.
*
* @internal
*/
var VolumeSliderCore = class VolumeSliderCore extends SliderCore {
	static defaultProps = {
		...SliderCore.defaultProps,
		label: "",
		step: 5,
		wheelStep: 5
	};
	#wheelStep = VolumeSliderCore.defaultProps.wheelStep;
	#media = null;
	#formatLocale;
	constructor(props) {
		super();
		if (props) this.setProps(props);
	}
	setProps(props) {
		const resolvedProps = defaults(props, VolumeSliderCore.defaultProps);
		this.#wheelStep = resolvedProps.wheelStep;
		super.setProps(resolvedProps);
	}
	setMedia(media) {
		this.#media = media;
	}
	/** @internal Platform adapters set the active i18n locale for `aria-valuetext` percent formatting. */
	setFormatLocale(locale) {
		this.#formatLocale = locale;
	}
	getState() {
		const media = this.#media;
		const { volume, muted } = media;
		const effectivelyMuted = muted || volume === 0;
		const { dragging, dragPercent } = this.input;
		const volumePercent = volume * 100;
		const value = dragging ? this.valueFromPercent(dragPercent) : volumePercent;
		const base = super.getSliderState(value);
		const availability = media.volumeAvailability;
		return {
			...base,
			disabled: base.disabled || availability !== "available",
			fillPercent: effectivelyMuted ? 0 : base.fillPercent,
			volume,
			muted: effectivelyMuted,
			availability,
			hidden: availability !== "available"
		};
	}
	/** Wheel step as a percentage of the slider range. */
	getWheelStepPercent() {
		const { min, max } = this.props;
		const range = max - min;
		return range > 0 ? this.#wheelStep / range * 100 : 0;
	}
	getLabel(state) {
		return super.getLabel(state) || labelText;
	}
	getValueText(state) {
		return state.muted ? mutedValueText : this.getValueTextParams(state).percent;
	}
	getValueTextParams(state) {
		return { percent: formatPercent(state.value / 100, this.#formatLocale) };
	}
	getAttrs(state) {
		return {
			...super.getAttrs(state),
			"aria-valuetext": this.getValueText(state)
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/volume-slider/data.js
/** @internal */
const VolumeSliderDataAttrs = {
	...SliderDataAttrs,
	availability: "data-availability",
	hidden: "data-hidden"
};

//#endregion
//#region ../html/dist/dev/ui/volume-slider/element.js
/**
* @fires drag-start - Fired when a pointer drag starts.
* @fires drag-end - Fired when a pointer drag ends.
*/
var VolumeSliderElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.label = "";
		this.step = VolumeSliderCore.defaultProps.step;
		this.largeStep = VolumeSliderCore.defaultProps.largeStep;
		this.wheelStep = VolumeSliderCore.defaultProps.wheelStep;
		this.orientation = VolumeSliderCore.defaultProps.orientation;
		this.disabled = VolumeSliderCore.defaultProps.disabled;
		this.thumbAlignment = VolumeSliderCore.defaultProps.thumbAlignment;
		this.#core = new VolumeSliderCore();
		this.#controlsState = new PlayerController(this, playerContext, selectControls);
		this.#provider = new ContextProvider(this, { context: sliderContext });
		this.#volumeState = new PlayerController(this, playerContext, selectVolume);
		this.#i18n = new I18nController(this, i18nContext);
		this.#slider = null;
		this.#disconnect = null;
		this.#releaseControlsLock = null;
	}
	static {
		this.tagName = "media-volume-slider";
	}
	static {
		this.properties = {
			label: { type: String },
			step: { type: Number },
			largeStep: {
				type: Number,
				attribute: "large-step"
			},
			wheelStep: {
				type: Number,
				attribute: "wheel-step"
			},
			orientation: { type: String },
			disabled: { type: Boolean },
			thumbAlignment: {
				type: String,
				attribute: "thumb-alignment"
			}
		};
	}
	#core;
	#controlsState;
	#provider;
	#volumeState;
	#i18n;
	#slider;
	#disconnect;
	#releaseControlsLock;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#disconnect = new AbortController();
		const signal = this.#disconnect.signal;
		const isDisabled = () => {
			const volume = this.#volumeState.value;
			return this.disabled || !volume || volume.volumeAvailability !== "available";
		};
		const getPercent = () => (this.#volumeState.value?.volume ?? 0) * 100;
		const getStepPercent = () => this.#core.getStepPercent();
		const setVolume = (percent) => this.#setVolume(percent);
		this.#slider = createSlider({
			getElement: () => this,
			getThumbElement: () => this.querySelector("media-slider-thumb"),
			getOrientation: () => this.orientation,
			isDisabled,
			getPercent,
			getStepPercent,
			getLargeStepPercent: () => this.#core.getLargeStepPercent(),
			onValueChange: setVolume,
			onValueCommit: setVolume,
			onPressStart: () => {
				this.#releaseControlsLock ??= this.#controlsState.value?.requestControlsLock() ?? null;
			},
			onPressEnd: () => this.#releaseControlsVisibilityLock(),
			onDragStart: () => {
				this.dispatchEvent(new CustomEvent("drag-start", { bubbles: true }));
			},
			onDragEnd: () => {
				this.dispatchEvent(new CustomEvent("drag-end", { bubbles: true }));
			},
			adjustPercent: (raw, thumbSize, trackSize) => this.#core.adjustPercentForAlignment(raw, thumbSize, trackSize),
			onResize: () => {
				if (this.thumbAlignment === "edge") this.requestUpdate();
			}
		});
		const wheelProps = createWheelStep({
			isDisabled,
			getPercent,
			getStepPercent: () => this.#core.getWheelStepPercent(),
			onValueChange: (percent) => this.#volumeState.value?.setVolume(this.#core.rawValueFromPercent(percent) / 100)
		});
		applyElementProps(this, this.#slider.rootProps, { signal });
		applyElementProps(this, wheelProps, { signal });
		applyStyles(this, this.#slider.rootStyle);
		this.#slider.input.subscribe(() => this.requestUpdate(), { signal });
		if (!this.#volumeState.value) logMissingFeature(this.localName, this.#volumeState.displayName);
	}
	disconnectedCallback() {
		this.#releaseControlsVisibilityLock();
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#releaseControlsVisibilityLock();
		this.#slider?.destroy();
		super.destroyCallback();
	}
	#releaseControlsVisibilityLock() {
		this.#releaseControlsLock?.();
		this.#releaseControlsLock = null;
	}
	willUpdate(_changed) {
		super.willUpdate(_changed);
		this.#core.setProps(this);
		this.#core.setFormatLocale(this.#i18n.locale);
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#slider) return;
		const media = this.#volumeState.value;
		if (!media) return;
		this.#core.setInput(this.#slider.input.current);
		this.#core.setMedia(media);
		const state = this.#core.getState();
		const cssVars = getSliderCSSVars(this.#slider.adjustForAlignment(state));
		const thumbAttrs = this.#core.getAttrs(state);
		applyStyles(this, cssVars);
		applyStateDataAttrs(this, state, VolumeSliderDataAttrs);
		applyElementProps(this, { hidden: state.hidden ? "" : void 0 });
		this.#provider.setValue({
			state,
			stateAttrMap: VolumeSliderDataAttrs,
			pointerValue: this.#core.valueFromPercent(state.pointerPercent),
			thumbAttrs: {
				...thumbAttrs,
				"aria-label": translateText(thumbAttrs["aria-label"], this.#i18n.value),
				"aria-valuetext": translateText(thumbAttrs["aria-valuetext"], this.#i18n.value, this.#core.getValueTextParams(state))
			},
			thumbProps: this.#slider.thumbProps,
			formatValue: (value) => `${Math.round(value)}%`
		});
	}
	#setVolume(percent) {
		this.#volumeState.value?.setVolume(this.#core.valueFromPercent(percent) / 100);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/volume-slider.js
safeDefine(VolumeSliderElement);

//#endregion
//# sourceMappingURL=volume-slider.dev.js.map