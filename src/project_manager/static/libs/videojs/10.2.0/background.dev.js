/*! Video.js | https://videojs.org/help */
import { r as backgroundFeatures, t as createPlayer } from "./create-player-CJ6Pa0TV.js";
import { r as ensureGlobalStyle } from "./shadow-styles-CjVI1B1u.js";
import { n as ReactiveElement } from "./ui-element--3_7he7k.js";
import { t as safeDefine } from "./safe-define-THEasJ9B.js";
import "./ui/container.dev.js";
import "./background-video-BSkkfaUN.js";

//#region ../html/dist/dev/presets/background/player.js
const { PlayerElement, PlayerController: BackgroundVideoPlayerController } = createPlayer({ features: backgroundFeatures });
var BackgroundVideoPlayerElement = class extends PlayerElement {
	static {
		this.tagName = "background-video-player";
	}
};

//#endregion
//#region ../html/dist/dev/define/background/player.js
safeDefine(BackgroundVideoPlayerElement);

//#endregion
//#region ../html/dist/dev/define/background/skin2.js
var skin_default = "background-video-player {\n  display: contents;\n}\n\nbackground-video-skin {\n  --media-object-fit: cover;\n  object-fit: var(--media-object-fit);\n  width: 100%;\n  min-width: 300px;\n  height: 100%;\n  min-height: 150px;\n  display: block;\n  position: relative;\n}\n\nbackground-video-skin > :not(img, picture) {\n  object-fit: var(--media-object-fit);\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n}\n\nbackground-video-skin > img, background-video-skin > picture {\n  object-fit: var(--media-object-fit);\n  width: 100%;\n  height: 100%;\n}\n";

//#endregion
//#region ../html/dist/dev/presets/background/skin.js
const STYLES_ID = "__media-background-styles";
function getTemplateHTML() {
	return `
    <media-container>
      <!-- @deprecated slot="media" is no longer required, use the default slot instead -->
      <slot name="media"></slot>
      <slot></slot>
    </media-container>
  `;
}
var BackgroundVideoSkinElement = class BackgroundVideoSkinElement extends ReactiveElement {
	static {
		this.tagName = "background-video-skin";
	}
	static {
		this.shadowRootOptions = { mode: "open" };
	}
	static {
		this.getTemplateHTML = getTemplateHTML;
	}
	constructor() {
		super();
		ensureGlobalStyle(STYLES_ID, skin_default);
		if (!this.shadowRoot) {
			this.attachShadow(BackgroundVideoSkinElement.shadowRootOptions);
			this.shadowRoot.innerHTML = getTemplateHTML();
		}
	}
};

//#endregion
//#region ../html/dist/dev/define/background/skin.js
safeDefine(BackgroundVideoSkinElement);

//#endregion
//# sourceMappingURL=background.dev.js.map