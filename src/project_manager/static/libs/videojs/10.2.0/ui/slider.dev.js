/*! Video.js | https://videojs.org/help */
import { t as ContextProvider } from "../context-provider-2u40YNUB.js";
import { r as i18nContext, t as I18nController } from "../controller-CKtzV_P4.js";
import { t as applyStyles } from "../style-CFppx62l.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { n as SliderCore, r as createSlider, t as SliderDataAttrs } from "../data-BgILZtly.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { r as selectControls } from "../selectors-B0umcXKn.js";
import { t as getSliderCSSVars } from "../css-vars-CBwz-Iu0.js";
import { t as applyElementProps } from "../element-props-CYmZOrQN.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";
import { translateText } from "../i18n.dev.js";

//#region ../html/dist/dev/ui/slider/element.js
/**
* @fires value-change - Fired while the slider value changes during an interaction.
* @fires value-commit - Fired when an interaction commits the slider value.
* @fires drag-start - Fired when a pointer drag starts.
* @fires drag-end - Fired when a pointer drag ends.
*/
var SliderElement = class extends UIElement {
	constructor(..._args) {
		super(..._args);
		this.label = "";
		this.value = SliderCore.defaultProps.value;
		this.min = SliderCore.defaultProps.min;
		this.max = SliderCore.defaultProps.max;
		this.step = SliderCore.defaultProps.step;
		this.largeStep = SliderCore.defaultProps.largeStep;
		this.orientation = SliderCore.defaultProps.orientation;
		this.disabled = SliderCore.defaultProps.disabled;
		this.thumbAlignment = SliderCore.defaultProps.thumbAlignment;
		this.#core = new SliderCore();
		this.#controlsState = new PlayerController(this, playerContext, selectControls);
		this.#i18n = new I18nController(this, i18nContext);
		this.#provider = new ContextProvider(this, { context: sliderContext });
		this.#slider = null;
		this.#disconnect = null;
		this.#releaseControlsLock = null;
	}
	static {
		this.tagName = "media-slider";
	}
	static {
		this.properties = {
			label: { type: String },
			value: { type: Number },
			min: { type: Number },
			max: { type: Number },
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
			}
		};
	}
	#core;
	#controlsState;
	#i18n;
	#provider;
	#slider;
	#disconnect;
	#releaseControlsLock;
	connectedCallback() {
		super.connectedCallback();
		if (this.destroyed) return;
		this.#disconnect = new AbortController();
		const signal = this.#disconnect.signal;
		this.#slider = createSlider({
			getElement: () => this,
			getThumbElement: () => this.querySelector("media-slider-thumb"),
			getOrientation: () => this.orientation,
			isDisabled: () => this.disabled,
			getPercent: () => this.#core.percentFromValue(this.value),
			getStepPercent: () => this.#core.getStepPercent(),
			getLargeStepPercent: () => this.#core.getLargeStepPercent(),
			onValueChange: (percent) => {
				this.value = this.#core.valueFromPercent(percent);
				this.dispatchEvent(new CustomEvent("value-change", {
					detail: { value: this.value },
					bubbles: true
				}));
			},
			onValueCommit: (percent) => {
				this.value = this.#core.valueFromPercent(percent);
				this.dispatchEvent(new CustomEvent("value-commit", {
					detail: { value: this.value },
					bubbles: true
				}));
			},
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
		applyElementProps(this, this.#slider.rootProps, { signal });
		applyStyles(this, this.#slider.rootStyle);
		this.#slider.input.subscribe(() => this.requestUpdate(), { signal });
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
	}
	update(_changed) {
		super.update(_changed);
		if (!this.#slider) return;
		this.#core.setInput(this.#slider.input.current);
		const state = this.#core.getSliderState(this.value);
		const cssVars = getSliderCSSVars(this.#slider.adjustForAlignment(state));
		applyStyles(this, cssVars);
		applyStateDataAttrs(this, state, SliderDataAttrs);
		this.#provider.setValue({
			state,
			stateAttrMap: SliderDataAttrs,
			pointerValue: this.#core.valueFromPercent(state.pointerPercent),
			thumbAttrs: (() => {
				const attrs = this.#core.getAttrs(state);
				return {
					...attrs,
					"aria-label": translateText(attrs["aria-label"], this.#i18n.value)
				};
			})(),
			thumbProps: this.#slider.thumbProps
		});
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/slider.js
safeDefine(SliderElement);

//#endregion
//# sourceMappingURL=slider.dev.js.map