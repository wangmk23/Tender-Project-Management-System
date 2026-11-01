import { f as isUndefined } from "./predicate-3rF1m2uv.js";
import { n as MediaStreamTypes } from "./types-D8a85nGw.js";

//#region ../html/dist/dev/media/mux-video/mixin.js
/**
* The Mux-specific element behavior, over any Mux Media: the `poster-time` attribute, `src` reflection, and the
* storyboard `<track>` child.
*
* Mixin rather than a base class because each flavor's element is built on a different `CustomMediaElement`, so there
* is no common class to extend — only a common adapter contract.
*/
function MuxVideoMixin(BaseClass) {
	class MuxVideoElement extends BaseClass {
		static get observedAttributes() {
			return [...BaseClass.observedAttributes ?? [], "poster-time"];
		}
		constructor(...args) {
			super(...args);
			this.adapter.addEventListener("streamtypechange", () => this.#syncStoryboard());
			this.adapter.addEventListener("sourcechange", () => {
				this.#reflectSrc();
				this.#syncPosterTime();
				this.#syncStoryboard();
			});
		}
		attributeChangedCallback(name, oldValue, newValue) {
			if (name === "poster-time") {
				if (newValue === null) this.#applyPosterTime(void 0);
				else this.#syncPosterTime();
				return;
			}
			super.attributeChangedCallback?.(name, oldValue, newValue);
		}
		#posterTimeAttr() {
			const attr = this.getAttribute("poster-time");
			const parsed = attr ? Number(attr) : NaN;
			return Number.isNaN(parsed) ? void 0 : parsed;
		}
		#syncPosterTime() {
			const time = this.#posterTimeAttr();
			if (!isUndefined(time)) this.#applyPosterTime(time);
		}
		#applyPosterTime(time) {
			const source = this.adapter.source;
			if (source?.poster?.time === time) return;
			if (!source) return;
			const poster = { ...source?.poster };
			if (isUndefined(time)) delete poster.time;
			else poster.time = time;
			this.adapter.source = {
				...source,
				poster: Object.keys(poster).length > 0 ? poster : void 0
			};
		}
		#reflectSrc() {
			const src = this.adapter.src;
			if (src) {
				if (this.getAttribute("src") !== src) this.setAttribute("src", src);
			} else if (this.hasAttribute("src")) this.removeAttribute("src");
		}
		#syncStoryboard() {
			const src = this.adapter.streamType === MediaStreamTypes.LIVE ? void 0 : this.adapter.contentData.storyboard;
			let track = this.querySelector("track[data-storyboard]");
			if (!src) {
				track?.remove();
				return;
			}
			if (!track) {
				track = document.createElement("track");
				track.kind = "metadata";
				track.label = "thumbnails";
				track.default = true;
				track.setAttribute("data-storyboard", "");
			}
			if (track.getAttribute("src") !== src) track.setAttribute("src", src);
			if (track.parentNode !== this) this.append(track);
		}
	}
	return MuxVideoElement;
}

//#endregion
export { MuxVideoMixin as t };
//# sourceMappingURL=mixin-C4uZGyLO.js.map