//#region ../media/dist/dev/core/registered-media.js
/**
* Key a player media facade answers with the media the player registered, which the facade wraps. `Symbol.for` so a
* page carrying two copies of the packages (CDN plus npm, duplicate installs) still agrees on it, and so it can never
* collide with a media member.
*
* @internal
*/
const REGISTERED_MEDIA = Symbol.for("@videojs/media/registered");
/**
* The media the player registered: the media behind a player facade, or `media` itself when it isn't one. Identity
* checks and native-element lookups must go through this: a facade passes `instanceof` for the element it wraps but is
* never identical to it.
*
* @internal
*/
function getRegisteredMedia(media) {
	return media?.[REGISTERED_MEDIA] ?? media;
}

//#endregion
export { getRegisteredMedia as n, REGISTERED_MEDIA as t };
//# sourceMappingURL=registered-media-Xx5cjTln.js.map