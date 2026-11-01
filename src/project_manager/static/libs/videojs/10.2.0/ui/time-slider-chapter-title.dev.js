/*! Video.js | https://videojs.org/help */
import { t as ContextConsumer } from "../context-consumer-LN8LIb2c.js";
import { t as UIElement } from "../ui-element--3_7he7k.js";
import { t as safeDefine } from "../safe-define-THEasJ9B.js";
import { i as playerContext } from "../context-CL8SSE10.js";
import { t as PlayerController } from "../controller-BArmvAzk.js";
import { m as selectTime, p as selectTextTrack } from "../selectors-B0umcXKn.js";
import { t as TimeSliderChaptersCore } from "../core-BwqYdF7-.js";
import { t as sliderContext } from "../context-B7UTlu8X.js";

//#region ../html/dist/dev/ui/time-slider/chapter-title.js
/** Displays the chapter title at the current pointer or keyboard position. */
var TimeSliderChapterTitleElement = class extends UIElement {
	static {
		this.tagName = "media-time-slider-chapter-title";
	}
	#core = new TimeSliderChaptersCore();
	#slider = new ContextConsumer(this, {
		context: sliderContext,
		subscribe: true
	});
	#textTrack = new PlayerController(this, playerContext, selectTextTrack);
	#time = new PlayerController(this, playerContext, selectTime);
	update(_changed) {
		super.update(_changed);
		const slider = this.#slider.value;
		if (!slider) return;
		const duration = this.#time.value?.duration ?? 0;
		const { chapters } = this.#core.getRanges(this.#textTrack.value?.chaptersCues ?? [], 0, duration);
		const keyboard = slider.state.interactive && !slider.state.pointing && !slider.state.dragging;
		const value = slider.state.pointing || slider.state.dragging ? slider.pointerValue : slider.state.value;
		const chapter = this.#core.findChapter(chapters, value);
		this.textContent = chapter?.cue?.text ?? "";
		if (keyboard) {
			this.removeAttribute("aria-hidden");
			this.setAttribute("aria-live", "polite");
		} else {
			this.setAttribute("aria-hidden", "true");
			this.removeAttribute("aria-live");
		}
	}
};

//#endregion
//#region ../html/dist/dev/define/ui/time-slider-chapter-title.js
safeDefine(TimeSliderChapterTitleElement);

//#endregion
//# sourceMappingURL=time-slider-chapter-title.dev.js.map