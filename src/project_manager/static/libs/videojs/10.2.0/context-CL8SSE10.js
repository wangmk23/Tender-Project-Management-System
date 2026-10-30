import { t as createContext } from "./create-context-Dp8VhaeT.js";

//#region ../html/dist/dev/player/context.js
const PLAYER_CONTEXT_KEY = Symbol.for("@videojs/player");
/**
* The default player context instance for consuming the player store in controllers.
*
* @public
*/
const playerContext = createContext(PLAYER_CONTEXT_KEY);
/** @internal */
const MEDIA_CONTEXT_KEY = Symbol.for("@videojs/media");
/** @internal */
const mediaContext = createContext(MEDIA_CONTEXT_KEY);
/** @internal */
const CONTAINER_CONTEXT_KEY = Symbol.for("@videojs/container");
/** @internal */
const containerContext = createContext(CONTAINER_CONTEXT_KEY);
/** @internal */
const EXTENSION_CONTEXT_KEY = Symbol.for("@videojs/extension");
/** @internal */
const extensionContext = createContext(EXTENSION_CONTEXT_KEY);

//#endregion
export { playerContext as i, extensionContext as n, mediaContext as r, containerContext as t };
//# sourceMappingURL=context-CL8SSE10.js.map