import { o as videoFeatures, t as createPlayer } from "./create-player-CJ6Pa0TV.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";

//#region ../html/dist/dev/presets/video/player.js
const { PlayerElement, PlayerController: VideoPlayerController } = createPlayer({ features: videoFeatures });
/**
* Player-state provider registered as `<video-player>`.
*
* The element owns the configured video store but no layout. Put a skin or `<media-container>` inside it to provide the
* media, controls, and fullscreen target.
*/
var VideoPlayerElement = class extends PlayerElement {
	static {
		this.tagName = "video-player";
	}
};

//#endregion
//#region ../html/dist/dev/define/video/player.js
safeDefine(VideoPlayerElement);

//#endregion
//# sourceMappingURL=player-CruLuUd6.js.map