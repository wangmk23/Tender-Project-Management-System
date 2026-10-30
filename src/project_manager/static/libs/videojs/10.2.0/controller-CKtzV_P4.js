import { t as createContext } from "./create-context-Dp8VhaeT.js";
import { t as ContextConsumer } from "./context-consumer-LN8LIb2c.js";
import { DEFAULT_LOCALE, createTranslator, getI18nTranslations, onI18nRegistryChange } from "./i18n.dev.js";

//#region ../html/dist/dev/i18n/context.js
const I18N_CONTEXT_KEY = Symbol.for("@videojs/i18n");
/**
* The default HTML context carrying the active translator and locale.
*
* @public
*/
const i18nContext = createContext(I18N_CONTEXT_KEY);

//#endregion
//#region ../html/dist/dev/i18n/controller.js
let fallbackTranslator;
function getFallbackTranslator() {
	fallbackTranslator ??= createTranslator(getI18nTranslations(DEFAULT_LOCALE), DEFAULT_LOCALE);
	return fallbackTranslator;
}
/** Consumes an i18n context and updates its host when the translator or locale changes. */
var I18nController = class {
	#host;
	#consumer;
	#unsubscribeRegistry;
	/**
	* @param host - Reactive host updated when the i18n value changes.
	* @param context - I18n context to consume.
	*/
	constructor(host, context) {
		this.#host = host;
		this.#consumer = new ContextConsumer(host, {
			context,
			callback: () => this.#host.requestUpdate(),
			subscribe: true
		});
		host.addController(this);
	}
	get value() {
		return this.#consumer.value?.translator ?? getFallbackTranslator();
	}
	get locale() {
		return this.#consumer.value?.locale ?? DEFAULT_LOCALE;
	}
	hostConnected() {
		fallbackTranslator = void 0;
		this.#unsubscribeRegistry = onI18nRegistryChange(() => {
			fallbackTranslator = void 0;
			if (!this.#consumer.value) this.#host.requestUpdate();
		});
	}
	hostDisconnected() {
		this.#unsubscribeRegistry?.();
		this.#unsubscribeRegistry = void 0;
	}
};

//#endregion
export { getFallbackTranslator as n, i18nContext as r, I18nController as t };
//# sourceMappingURL=controller-CKtzV_P4.js.map