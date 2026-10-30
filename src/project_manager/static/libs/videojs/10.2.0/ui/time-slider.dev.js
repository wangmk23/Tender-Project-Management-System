/*! Video.js | https://videojs.org/help */
import { t as defaults } from "../defaults-nT7MwJ_t.js";
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { O as animationFrame } from "../volume-aFyxrX8a.js";
import { t as applyStyles } from "../style-CFppx62l.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { n as SliderCore, r as createSlider, t as SliderDataAttrs } from "../data-BgILZtly.js";
import { t as createState } from "../state-DLDF0q4U.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { m as isMediaPlaying, r as hasTimeRange, t as getTimeRangeEnd } from "../predicate-VHPnHoui.js";
import { l as selectPlayback, m as selectTime, n as selectBuffer, r as selectControls } from "../selectors-B0umcXKn.js";
import { r as toPercent } from "../number-D2skb7-A.js";
import { i as SliderCSSVars, r as getTimeSliderCSSVars } from "../css-vars-CBwz-Iu0.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as logMissingFeature } from "../log-DrTPNK96.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { n as formatTimeAsPhrase, t as formatTime } from "../format-Dhaf9oDP.js";
import { a as positionText, p as unknownText } from "../time-e6HJCQ4C.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";
import { translateText } from "../i18n.dev.js";

//#region ../core/dist/dev/dom/ui/time-slider/seek.js
/** Hold the clicked position until seeking and the presentation layer's transition finish. @internal */
function createTimeSliderSeek(property) {
	const state = createState({ percent: void 0 });
	let cancel;
	let seeking = false;
	let element = null;
	function frame() {
		const transitioning = element?.getAnimations?.().some((animation) => "transitionProperty" in animation && animation.transitionProperty === property && animation.playState !== "finished");
		if (seeking || transitioning) {
			cancel = animationFrame(frame);
			return;
		}
		cancel = void 0;
		state.patch({ percent: void 0 });
	}
	function seek(percent) {
		cancel?.();
		state.patch({ percent });
		cancel = animationFrame(frame);
	}
	return {
		state,
		seek,
		update(next, percent, el) {
			element = el;
			if (next && !seeking && state.current.percent === void 0) seek(percent);
			seeking = next;
		},
		destroy() {
			cancel?.();
			cancel = void 0;
			seeking = false;
			element = null;
			state.patch({ percent: void 0 });
		}
	};
}

//#endregion
//#region ../core/dist/dev/i18n/text/slider.js
const seekText = {
	key: `slider.seek`,
	text: "Seek"
};

//#endregion
//#region ../core/dist/dev/core/ui/time-slider/core.js
/**
* Time-domain slider: maps media time/buffer state to slider state.
*
* @internal
*/
var TimeSliderCore = class TimeSliderCore extends SliderCore {
	static defaultProps = {
		...SliderCore.defaultProps,
		label: "",
		changeThrottle: 100,
		pauseOnDrag: false
	};
	#props = { ...TimeSliderCore.defaultProps };
	#media = null;
	#formatLocale;
	#wasPlayingBeforeDrag = false;
	#text;
	constructor(props) {
		super();
		if (props) this.setProps(props);
	}
	setProps(props) {
		this.#props = defaults(props, TimeSliderCore.defaultProps);
		super.setProps({
			...props,
			min: 0
		});
	}
	setMedia(media) {
		this.#media = media;
	}
	/** @internal Platform adapters set the active i18n locale for `aria-valuetext` time formatting. */
	setFormatLocale(locale) {
		if (this.#formatLocale !== locale) this.#text = void 0;
		this.#formatLocale = locale;
	}
	getState() {
		const media = this.#media;
		const { currentTime, seeking, buffered } = media;
		const duration = getTimeRangeEnd(media);
		super.setProps({
			...this.#props,
			disabled: this.#props.disabled || !hasTimeRange(media),
			min: 0,
			max: duration
		});
		const base = super.getSliderState(currentTime);
		const bufferedEnd = buffered.length > 0 ? buffered[buffered.length - 1][1] : 0;
		const bufferPercent = toPercent(bufferedEnd, 0, duration);
		return {
			...base,
			currentTime,
			duration,
			seeking,
			bufferPercent
		};
	}
	getLabel(state) {
		return super.getLabel(state) || seekText;
	}
	#announceValue(state) {
		return state.dragging ? this.rawValueFromPercent(state.pointerPercent) : state.value;
	}
	#formatTimeAsPhrase(seconds) {
		return this.#formatLocale === void 0 ? formatTimeAsPhrase(seconds) : formatTimeAsPhrase(seconds, { locale: this.#formatLocale });
	}
	getValueText(state) {
		if (state.duration <= 0) return unknownText;
		return Number.isFinite(state.duration) ? positionText : this.getValueTextParams(state).current;
	}
	getValueTextParams(state) {
		const current = Math.floor(this.#announceValue(state));
		const duration = Math.floor(state.duration);
		if (this.#text && this.#text.current === current && this.#text.duration === duration) return this.#text.params;
		const params = Number.isFinite(duration) ? {
			current: this.#formatTimeAsPhrase(current),
			duration: this.#formatTimeAsPhrase(duration)
		} : { current: this.#formatTimeAsPhrase(current) };
		this.#text = {
			current,
			duration,
			params
		};
		return params;
	}
	/**
	* Pause playback when a drag begins if `pauseOnDrag` is enabled, remembering whether media was playing so `endDrag`
	* can resume it.
	*/
	startDrag(playback) {
		this.#wasPlayingBeforeDrag = false;
		if (this.#props.pauseOnDrag && playback && !playback.paused) {
			this.#wasPlayingBeforeDrag = true;
			playback.pause();
		}
	}
	/**
	* Resume playback if `startDrag` paused it. Resume depends only on the intent captured at drag start, so it survives
	* `pauseOnDrag` being toggled mid-drag. Safe to call on teardown — a no-op unless a drag paused playback.
	*/
	endDrag(playback) {
		if (this.#wasPlayingBeforeDrag) playback?.play().catch(() => {});
		this.#wasPlayingBeforeDrag = false;
	}
	getAttrs(state) {
		const base = super.getAttrs(state);
		const announceValue = this.#announceValue(state);
		return {
			...base,
			"aria-valuenow": announceValue,
			"aria-valuetext": this.getValueText(state)
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/time-slider/data.js
/** @internal */
const TimeSliderDataAttrs = {
	...SliderDataAttrs,
	/** Present when a seek operation is in progress. */
	seeking: "data-seeking"
};

//#endregion
//#region ../html/dist/dev/ui/time-slider/element.js
/**
* @fires drag-start - Fired when a pointer drag starts.
* @fires drag-end - Fired when a pointer drag ends.
*/
var TimeSliderElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.label = "";
		this.changeThrottle = TimeSliderCore.defaultProps.changeThrottle;
		this.step = TimeSliderCore.defaultProps.step;
		this.largeStep = TimeSliderCore.defaultProps.largeStep;
		this.orientation = TimeSliderCore.defaultProps.orientation;
		this.disabled = TimeSliderCore.defaultProps.disabled;
		this.thumbAlignment = TimeSliderCore.defaultProps.thumbAlignment;
		this.pauseOnDrag = TimeSliderCore.defaultProps.pauseOnDrag;
		this.#core = new TimeSliderCore();
		this.#controlsState = new PlayerController(this, playerContext, selectControls);
		this.#provider = new ContextProvider(this, { context: sliderContext });
		this.#timeState = new PlayerController(this, playerContext, selectTime);
		this.#bufferState = new PlayerController(this, playerContext, selectBuffer);
		this.#playbackState = new PlayerController(this, playerContext, selectPlayback);
		this.#seek = createTimeSliderSeek(SliderCSSVars.fill);
		this.#i18n = new I18nController(this, i18nContext);
		this.#cssVars = {};
		this.#slider = null;
		this.#disconnect = null;
		this.#releaseControlsLock = null;
	}
	static {
		this.tagName = "media-time-slider";
	}
	static {
		this.properties = {
			label: { type: String },
			changeThrottle: {
				type: Number,
				attribute: "change-throttle"
			},
			step: { type: Number },
			largeStep: {
				type: Number,
				attribute: "large-step"
			},
			orientation: { type: String },
			disabled: { type: Boolean },
			thumbAlignment: {
				type: String,
				attribute: "thumb-alignment"
			},
			pauseOnDrag: {
				type: Boolean,
				attribute: "pause-on-drag"
			}
		};
	}
	#core;
	#controlsState;
	#provider;
	#timeState;
	#bufferState;
	#playbackState;
	#seek;
	#i18n;
	#cssVars;
	#slider;
	#disconnect;
	#releaseControlsLock;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#disconnect = new AbortController();
		const signal = this.#disconnect.signal;
		let dragSeekPercent;
		const seek = (percent) => {
			const media = this.#timeState.value;
			if (media) {
				const time = this.#core.rawValueFromPercent(percent);
				this.#seek.seek(percent);
				media.seek(time);
			}
		};
		this.#slider = createSlider({
			getElement: () => this,
			getThumbElement: () => this.querySelector("media-slider-thumb"),
			getOrientation: () => this.orientation,
			isDisabled: () => {
				const time = this.#timeState.value;
				const buffer = this.#bufferState.value;
				return this.disabled || !time || !hasTimeRange({
					...time,
					...buffer ?? {
						buffered: [],
						seekable: []
					}
				});
			},
			getPercent: () => {
				const media = this.#timeState.value;
				if (!media) return 0;
				return this.#core.percentFromValue(media.currentTime);
			},
			getStepPercent: () => this.#core.getStepPercent(),
			getLargeStepPercent: () => this.#core.getLargeStepPercent(),
			onValueChange: (percent) => {
				if (!this.#slider?.input.current.dragging || percent === dragSeekPercent) return;
				dragSeekPercent = percent;
				seek(percent);
			},
			onValueCommit: (percent) => {
				if (percent !== dragSeekPercent) seek(percent);
				dragSeekPercent = void 0;
			},
			changeThrottle: this.changeThrottle,
			onPressStart: () => {
				this.#releaseControlsLock ??= this.#controlsState.value?.requestControlsLock() ?? null;
			},
			onPressEnd: () => this.#releaseControlsVisibilityLock(),
			onDragStart: () => {
				this.#core.startDrag(this.#playbackState.value);
				this.dispatchEvent(new CustomEvent("drag-start", { bubbles: true }));
			},
			onDragEnd: () => {
				this.#core.endDrag(this.#playbackState.value);
				this.dispatchEvent(new CustomEvent("drag-end", { bubbles: true }));
			},
			adjustPercent: (raw, thumbSize, trackSize) => this.#core.adjustPercentForAlignment(raw, thumbSize, trackSize),
			onResize: () => {
				if (this.thumbAlignment === "edge") this.requestUpdate();
			}
		});
		applyElementProps(this, this.#slider.rootProps, { signal });
		applyStyles(this, this.#slider.rootStyle);
		this.#slider.input.subscribe(() => this.requestUpdate(), { signal });
		this.#seek.state.subscribe(() => this.requestUpdate(), { signal });
		if (!this.#timeState.value) logMissingFeature(this.localName, this.#timeState.displayName);
	}
	disconnectedCallback() {
		this.#releaseControlsVisibilityLock();
		this.#resumeIfDragPaused();
		this.#seek.destroy();
		super.disconnectedCallback();
		this.#disconnect?.abort();
		this.#disconnect = null;
	}
	destroyCallback() {
		this.#releaseControlsVisibilityLock();
		this.#resumeIfDragPaused();
		this.#seek.destroy();
		this.#slider?.destroy();
		super.destroyCallback();
	}
	#resumeIfDragPaused() {
		this.#core.endDrag(this.#playbackState.value);
	}
	#releaseControlsVisibilityLock() {
		this.#releaseControlsLock?.();
		this.#releaseControlsLock = null;
	}
	willUpdate(_changed) {
		super.willUpdate(_changed);
		this.#core.setProps({
			label: this.label,
			changeThrottle: this.changeThrottle,
			step: this.step,
			largeStep: this.largeStep,
			orientation: this.orientation,
			disabled: this.disabled,
			thumbAlignment: this.thumbAlignment,
			pauseOnDrag: this.pauseOnDrag
		});
		this.#core.setFormatLocale(this.#i18n.locale);
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#slider) return;
		const time = this.#timeState.value;
		const buffer = this.#bufferState.value;
		if (!time) {
			this.#seek.destroy();
			this.removeAttribute("data-playing");
			return;
		}
		this.#core.setInput(this.#slider.input.current);
		const media = {
			...time,
			...buffer ?? {
				buffered: [],
				seekable: []
			}
		};
		this.#core.setMedia(media);
		const state = this.#core.getState();
		this.#seek.update(state.seeking, state.fillPercent, this);
		const percent = this.#seek.state.current.percent;
		this.toggleAttribute("data-playing", isMediaPlaying(this.#playbackState.value) && !state.disabled && !state.dragging && !state.seeking && percent === void 0);
		const fill = percent === void 0 || state.dragging || state.disabled ? state : {
			...state,
			fillPercent: percent
		};
		const cssVars = getTimeSliderCSSVars(this.#slider.adjustForAlignment(fill));
		const styles = Object.fromEntries(Object.entries(cssVars).filter(([name, value]) => this.#cssVars[name] !== value));
		applyStyles(this, styles);
		this.#cssVars = cssVars;
		const thumbAttrs = this.#core.getAttrs(state);
		applyStateDataAttrs(this, state, TimeSliderDataAttrs);
		this.#provider.setValue({
			state,
			stateAttrMap: TimeSliderDataAttrs,
			pointerValue: this.#core.rawValueFromPercent(state.pointerPercent),
			thumbAttrs: {
				...thumbAttrs,
				"aria-label": translateText(thumbAttrs["aria-label"], this.#i18n.value),
				"aria-valuetext": translateText(thumbAttrs["aria-valuetext"], this.#i18n.value, this.#core.getValueTextParams(state))
			},
			thumbProps: this.#slider.thumbProps,
			formatValue: (value) => formatTime(value, state.duration, { locale: this.#i18n.locale })
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/time-slider.js
safeDefine(TimeSliderElement);

//#endregion
//# sourceMappingURL=time-slider.dev.js.map