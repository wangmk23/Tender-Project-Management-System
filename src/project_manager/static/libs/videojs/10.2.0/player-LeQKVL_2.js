import { i as liveAudioFeatures, t as createPlayer } from "./create-player-CJ6Pa0TV.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";

//#region ../html/dist/dev/presets/live-audio/player.js
const { PlayerElement, PlayerController: LiveAudioPlayerController } = createPlayer({ features: liveAudioFeatures });
var LiveAudioPlayerElement = class extends PlayerElement {
	static {
		this.tagName = "live-audio-player";
	}
};

//#endregion
//#region ../html/dist/dev/define/live-audio/player.js
safeDefine(LiveAudioPlayerElement);

//#endregion
//# sourceMappingURL=player-LeQKVL_2.js.map