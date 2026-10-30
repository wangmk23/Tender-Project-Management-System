//#region ../media/dist/dev/core/media-error.js
var MediaError = class MediaError extends Error {
	static MEDIA_ERR_ABORTED = 1;
	static MEDIA_ERR_NETWORK = 2;
	static MEDIA_ERR_DECODE = 3;
	static MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
	static MEDIA_ERR_ENCRYPTED = 5;
	static MEDIA_ERR_CUSTOM = 100;
	static defaultMessages = {
		1: "You stopped media playback before it finished.",
		2: "This media could not be loaded due to a network or server issue.",
		3: "This media could not be played. It may be corrupted, or your browser may not support its format.",
		4: "This media could not be loaded. It may be unavailable, or your browser may not support its format.",
		5: "This media could not be played because it could not be decrypted."
	};
	name;
	code;
	context;
	fatal;
	data;
	constructor(message, code = MediaError.MEDIA_ERR_CUSTOM, fatal, context) {
		super(message);
		this.name = "MediaError";
		this.code = code;
		this.context = context;
		this.fatal = fatal ?? (code >= MediaError.MEDIA_ERR_NETWORK && code <= MediaError.MEDIA_ERR_ENCRYPTED);
		if (!this.message) this.message = MediaError.defaultMessages[this.code] ?? "";
	}
};

//#endregion
export { MediaError as t };
//# sourceMappingURL=media-error-zO-Hg4un.js.map