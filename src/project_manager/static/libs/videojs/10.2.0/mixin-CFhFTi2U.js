//#region ../html/dist/dev/media/mux-audio/mixin.js
/**
* The Mux-specific element behavior for audio, over any Mux Media: reflecting the derived `src` back to the attribute.
*
* Much thinner than {@link MuxVideoMixin} because the rest of what that one does has no meaning here — Mux publishes no
* poster or storyboard for an audio-only asset, and an `<audio>` element renders neither.
*
* A mixin rather than a base class for the same reason as the video one: each flavor's element is built on a different
* `CustomMediaElement`, so there is no common class to extend, only a common adapter contract.
*/
function MuxAudioMixin(BaseClass) {
	class MuxAudioElement extends BaseClass {
		constructor(...args) {
			super(...args);
			this.adapter.addEventListener("sourcechange", () => this.#reflectSrc());
		}
		#reflectSrc() {
			const src = this.adapter.src;
			if (src) {
				if (this.getAttribute("src") !== src) this.setAttribute("src", src);
			} else if (this.hasAttribute("src")) this.removeAttribute("src");
		}
	}
	return MuxAudioElement;
}

//#endregion
export { MuxAudioMixin as t };
//# sourceMappingURL=mixin-CFhFTi2U.js.map