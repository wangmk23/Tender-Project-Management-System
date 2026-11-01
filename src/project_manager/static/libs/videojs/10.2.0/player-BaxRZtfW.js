import { n as audioFeatures, t as createPlayer } from "./create-player-CJ6Pa0TV.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";

//#region ../html/dist/dev/presets/audio/player.js
const { PlayerElement, PlayerController: AudioPlayerController } = createPlayer({ features: audioFeatures });
var AudioPlayerElement = class extends PlayerElement {
	static {
		this.tagName = "audio-player";
	}
};

//#endregion
//#region ../html/dist/dev/define/audio/player.js
safeDefine(AudioPlayerElement);

//#endregion
//# sourceMappingURL=player-BaxRZtfW.js.map