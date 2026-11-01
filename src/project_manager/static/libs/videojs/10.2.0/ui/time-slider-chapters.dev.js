/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { i as getTemplateRoot, r as getTemplateElement, t as cloneTemplateRoot } from "../template-Cya7joDn.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { m as selectTime, n as selectBuffer, p as selectTextTrack } from "../selectors-B0umcXKn.js";
import { r as toPercent } from "../number-D2skb7-A.js";
import { t as TimeSliderChaptersCore } from "../core-BwqYdF7-.js";
import { t as applyStateDataAttrs } from "../state-data-attrs-DiSfe3GX.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../core/dist/dev/core/ui/slider/segments.js
/**
* Localizes ordered numeric ranges into slider geometry and interaction state.
*
* @internal
*/
var SliderSegmentsCore = class {
	getGeometry(input) {
		const { ranges, min, max, orientation } = input;
		const domain = max - min;
		if (!Number.isFinite(domain) || domain <= 0) return [];
		const valid = ranges.filter((segment) => {
			const size = (segment.end - segment.start) / domain;
			const offset = (segment.start - min) / domain;
			return Number.isFinite(size) && Number.isFinite(offset) && size > 0;
		});
		return valid.map((segment, index) => {
			const offset = (segment.start - min) / domain;
			const size = (segment.end - segment.start) / domain;
			const segmentSize = `${size * 100}%`;
			return {
				...segment,
				index,
				last: index === valid.length - 1,
				orientation,
				width: orientation === "horizontal" ? segmentSize : void 0,
				height: orientation === "vertical" ? segmentSize : void 0,
				startPercent: `${offset * 100}%`,
				endPercent: `${(offset + size) * 100}%`
			};
		});
	}
	getState(segment, slider, pointerValue) {
		const { last, ...geometry } = segment;
		const contains = (value) => value >= segment.start && (value < segment.end || last && value === segment.end);
		const active = contains(slider.value);
		const pointing = slider.pointing && contains(pointerValue);
		const dragging = slider.dragging && contains(pointerValue);
		const focused = slider.interactive && !slider.pointing && !slider.dragging;
		return {
			...geometry,
			fillPercent: toPercent(slider.value, segment.start, segment.end),
			active,
			pointing,
			dragging,
			highlighted: segment.highlight !== false && pointing,
			interactive: pointing || dragging || focused && active
		};
	}
};

//#endregion
//#region ../core/dist/dev/core/ui/time-slider/chapters/data.js
/** @internal */
const TimeSliderChapterDataAttrs = {
	/** Present when playback is within the chapter. */
	active: "data-active",
	/** Present when pointer interaction highlights the chapter. */
	highlighted: "data-highlighted"
};

//#endregion
//#region ../core/dist/dev/core/ui/time-slider/chapters/vars.js
/**
* CSS geometry and progress local to each chapter.
*
* @internal
*/
const TimeSliderChapterCSSVars = {
	start: "--media-slider-chapter-start",
	end: "--media-slider-chapter-end",
	width: "--media-slider-chapter-width",
	fill: "--media-slider-chapter-fill",
	buffer: "--media-slider-chapter-buffer"
};

//#endregion
//#region ../html/dist/dev/ui/time-slider/chapters.js
/**
* Clones a light-DOM template once per normalized chapter range.
*
* The required template must contain exactly one HTML root element. When no chapter cues are available, the template is
* cloned once for a full-duration range.
*/
var TimeSliderChaptersElement = class extends UIElement {
	static {
		this.tagName = "media-time-slider-chapters";
	}
	#segments = new SliderSegmentsCore();
	#core = new TimeSliderChaptersCore();
	#slider = new ContextConsumer(this, {
		context: sliderContext,
		subscribe: true
	});
	#textTrack = new PlayerController(this, playerContext, selectTextTrack);
	#buffer = new PlayerController(this, playerContext, selectBuffer);
	#time = new PlayerController(this, playerContext, selectTime);
	#rendered = /* @__PURE__ */ new Map();
	#templateRoot = null;
	#templateChecked = false;
	connectedCallback() {
		super.connectedCallback();
		this.setAttribute("aria-hidden", "true");
	}
	update(_changed) {
		super.update(_changed);
		const slider = this.#slider.value;
		const duration = this.#time.value?.duration ?? 0;
		const templateRoot = this.#getTemplateRoot();
		if (!slider) return;
		applyStateDataAttrs(this, slider.state, slider.stateAttrMap);
		if (!templateRoot) return;
		const { chapters, ranges, max } = this.#core.getRanges(this.#textTrack.value?.chaptersCues ?? [], 0, duration);
		const geometry = this.#segments.getGeometry({
			ranges,
			min: 0,
			max,
			orientation: slider.state.orientation
		});
		const buffered = this.#buffer.value?.buffered ?? [];
		const bufferedEnd = buffered.length ? buffered[buffered.length - 1][1] : 0;
		const next = /* @__PURE__ */ new Map();
		for (const segment of geometry) {
			const state = this.#core.getState(this.#segments.getState(segment, slider.state, slider.pointerValue), chapters, bufferedEnd);
			let root = this.#rendered.get(state.key);
			if (!root) root = cloneTemplateRoot(templateRoot, this.ownerDocument);
			this.#setStyle(root, "pointer-events", state.cue ? void 0 : "none");
			this.#setStyle(root, TimeSliderChapterCSSVars.start, state.startPercent);
			this.#setStyle(root, TimeSliderChapterCSSVars.end, state.endPercent);
			this.#setStyle(root, TimeSliderChapterCSSVars.width, state.width ?? state.height);
			this.#setStyle(root, TimeSliderChapterCSSVars.fill, `${state.fillPercent}%`);
			this.#setStyle(root, TimeSliderChapterCSSVars.buffer, `${state.bufferPercent}%`);
			applyStateDataAttrs(root, slider.state, slider.stateAttrMap);
			applyStateDataAttrs(root, state, TimeSliderChapterDataAttrs);
			next.set(state.key, root);
		}
		for (const [key, root] of this.#rendered) if (!next.has(key)) root.remove();
		let before = null;
		for (const root of [...next.values()].reverse()) {
			if (root.parentNode !== this || root.nextSibling !== before) this.insertBefore(root, before);
			before = root;
		}
		this.#rendered.clear();
		for (const [key, rendered] of next) this.#rendered.set(key, rendered);
	}
	#getTemplateRoot() {
		if (this.#templateChecked) return this.#templateRoot;
		const template = getTemplateElement(this);
		if (!template) {
			for (const node of [...this.childNodes]) node.remove();
			return null;
		}
		this.#templateChecked = true;
		const root = getTemplateRoot(template);
		for (const node of [...this.childNodes]) if (node !== template) node.remove();
		if (root?.namespaceURI !== "http://www.w3.org/1999/xhtml") {
			console.warn(`[${this.localName}] template must contain exactly one HTML root element.`);
			return null;
		}
		this.#templateRoot = root;
		return this.#templateRoot;
	}
	#setStyle(element, name, value) {
		if (value === void 0) element.style.removeProperty(name);
		else element.style.setProperty(name, value);
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/time-slider-chapters.js
safeDefine(TimeSliderChaptersElement);

//#endregion
//# sourceMappingURL=time-slider-chapters.dev.js.map