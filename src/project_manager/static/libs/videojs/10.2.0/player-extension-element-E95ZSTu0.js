import { c as isObject } from "./predicate-3rF1m2uv.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { t as UIElement } from "./ui-element--3_7he7k.js";
import { n as extensionContext } from "./context-CL8SSE10.js";
import { n as getRegisteredMedia } from "./registered-media-Xx5cjTln.js";
import { t as HTMLMediaAdapter } from "./html-media-adapter-GddOWzPG.js";

//#region ../media/dist/dev/dom/utils/media-target.js
/**
* The media adapter behind a media the player resolved: the adapter itself, or the one a media component such as
* `<mux-video>` exposes as `adapter`. `null` for a plain `<video>` / `<audio>` or an unrelated media implementation.
*
* @internal
*/
function getMediaAdapter(media) {
	media = getRegisteredMedia(media);
	if (media instanceof HTMLMediaAdapter) return media;
	const adapter = isObject(media) ? media.adapter : null;
	return adapter instanceof HTMLMediaAdapter ? adapter : null;
}
/**
* The native element behind a media the player resolved: the element itself, or the one a media component or adapter
* fronts as `target`. `null` when the media is not backed by an `HTMLMediaElement` (an embed, for example).
*
* @internal
*/
function getMediaElement(media) {
	media = getRegisteredMedia(media);
	if (media instanceof HTMLMediaElement) return media;
	const target = isObject(media) ? media.target : null;
	return target instanceof HTMLMediaElement ? target : null;
}

//#endregion
//#region ../html/dist/dev/extensions/player-extension-element.js
/**
* Abstract base for elements that register a player extension (e.g. Mux Data, Google Cast) with the surrounding player.
*
* Place anywhere inside a player. The extension is registered when the element connects, follows the player's media
* (plain `<video>` / `<audio>` included) through the player itself, is released when this element disconnects, and is
* destroyed with this element.
*/
var PlayerExtensionElement = class extends UIElement {
	#extension = null;
	#register = null;
	#release = null;
	/** The player extension instance registered with the player. */
	get extension() {
		return this.#getExtension();
	}
	constructor() {
		super();
		new ContextConsumer(this, {
			context: extensionContext,
			subscribe: true,
			callback: (value) => this.#setRegister(value.registerExtension)
		});
	}
	disconnectedCallback() {
		this.#setRegister(null);
		super.disconnectedCallback();
	}
	destroyCallback() {
		this.#setRegister(null);
		this.#extension?.destroy?.();
		super.destroyCallback();
	}
	#setRegister(register) {
		if (this.#register === register) return;
		this.#release?.();
		this.#release = null;
		this.#register = register;
		if (register) this.#release = register(this.#getExtension());
	}
	#getExtension() {
		return this.#extension ??= this.createExtension();
	}
};

//#endregion
export { getMediaAdapter as n, getMediaElement as r, PlayerExtensionElement as t };
//# sourceMappingURL=player-extension-element-E95ZSTu0.js.map