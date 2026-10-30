import { s as isNumber } from "./predicate-3rF1m2uv.js";
import { c as isDefaultLocale } from "./i18n-ByQGZLGb.js";

//#region ../utils/dist/time/format.js
const durationFormatters = /* @__PURE__ */ new Map();
function createDurationFormatter(style, hoursDisplay, locale) {
	if (style === "digital") {
		const number = new Intl.NumberFormat(locale, { useGrouping: false });
		const padded = new Intl.NumberFormat(locale, {
			minimumIntegerDigits: 2,
			useGrouping: false
		});
		return { format: (duration) => {
			const body = `${padded.format(duration.minutes ?? 0)}:${padded.format(duration.seconds ?? 0)}`;
			return hoursDisplay === "always" || duration.hours !== void 0 ? `${number.format(duration.hours ?? 0)}:${body}` : body;
		} };
	}
	const units = [
		["hours", new Intl.NumberFormat(locale, {
			style: "unit",
			unit: "hour",
			unitDisplay: style
		})],
		["minutes", new Intl.NumberFormat(locale, {
			style: "unit",
			unit: "minute",
			unitDisplay: style
		})],
		["seconds", new Intl.NumberFormat(locale, {
			style: "unit",
			unit: "second",
			unitDisplay: style
		})]
	];
	const list = typeof Intl.ListFormat === "function" ? new Intl.ListFormat(locale, {
		type: "unit",
		style
	}) : { format: (parts) => [...parts].join(style === "narrow" ? " " : ", ") };
	return { format: (duration) => list.format(units.filter(([unit]) => duration[unit] !== void 0).map(([unit, formatter]) => formatter.format(duration[unit] ?? 0))) };
}
function localeCacheKey(locale) {
	if (locale === void 0) return "";
	return Array.isArray(locale) ? locale.join(":") : locale;
}
function getDurationFormatter(locale, style = "long", hoursDisplay) {
	const key = `${localeCacheKey(locale)}:${style}:${hoursDisplay ?? ""}`;
	let formatter = durationFormatters.get(key);
	if (!formatter) {
		formatter = createDurationFormatter(style, hoursDisplay, locale);
		durationFormatters.set(key, formatter);
	}
	return formatter;
}
function isValidTime(value) {
	return isNumber(value) && Number.isFinite(value);
}
/**
* Format seconds to digital display string.
*
* @example
*   formatTime(90); // "1:30"
*   formatTime(3661); // "1:01:01"
*   formatTime(35, 3600); // "0:00:35" (guided by 1-hour duration)
*   formatTime(35, 600); // "00:35" (guided by 10-minute duration)
*
* @param seconds - Time in seconds (can be negative)
* @param guide - Guide time (typically duration) to determine display format
* @param options - Digital formatting options
* @returns Formatted string like "1:30" or "1:05:30"
* @internal
*/
function formatTime(seconds, guide, options) {
	if (!isValidTime(seconds)) return "0:00";
	const negative = seconds < 0;
	const totalSeconds = Math.floor(Math.abs(seconds));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor(totalSeconds % 3600 / 60);
	const secondsPart = totalSeconds % 60;
	const guideSeconds = isValidTime(guide ?? 0) ? Math.abs(guide ?? 0) : 0;
	const guideHours = Math.floor(guideSeconds / 3600);
	const guideMinutes = Math.floor(guideSeconds / 60 % 60);
	const showHours = hours > 0 || guideHours > 0;
	const padMinutes = showHours || guideMinutes >= 10;
	const duration = showHours ? {
		hours,
		minutes,
		seconds: secondsPart
	} : {
		minutes,
		seconds: secondsPart
	};
	const { locale = "en" } = options ?? {};
	let body = getDurationFormatter(locale, "digital", showHours ? "always" : "auto").format(duration);
	if (!padMinutes) {
		const zero = new Intl.NumberFormat(locale, { useGrouping: false }).format(0);
		body = body.replace(new RegExp(`^${zero}(?=\\p{Nd}\\D)`, "u"), "");
	}
	return `${negative ? "-" : ""}${body}`;
}
/**
* Convert seconds to ISO 8601 duration for datetime attribute.
*
* @example
*   secondsToIsoDuration(90); // "PT1M30S"
*   secondsToIsoDuration(3661); // "PT1H1M1S"
*
* @param seconds - Time in seconds
* @returns ISO 8601 duration string like "PT1M30S"
* @internal
*/
function secondsToIsoDuration(seconds) {
	if (!isValidTime(seconds)) return "PT0S";
	const positiveSeconds = Math.abs(seconds);
	const h = Math.floor(positiveSeconds / 3600);
	const m = Math.floor(positiveSeconds / 60 % 60);
	const s = Math.floor(positiveSeconds % 60);
	let duration = "PT";
	if (h > 0) duration += `${h}H`;
	if (m > 0) duration += `${m}M`;
	if (s > 0 || duration === "PT") duration += `${s}S`;
	return duration;
}
/**
* Human-readable duration using `Intl.NumberFormat` and `Intl.ListFormat`.
*
* Negative `seconds` denote remaining time: the absolute value is formatted, then wrapped in a localized phrase via
* {@link TimeFormatOptions.formatRemaining}; otherwise `{duration} remaining`.
*
* @internal
*/
function formatTimeAsPhrase(seconds, options) {
	if (!isValidTime(seconds)) return "";
	const { locale = "en", style = "long", formatRemaining } = options ?? {};
	const negative = seconds < 0;
	const totalSeconds = Math.floor(Math.abs(seconds));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor(totalSeconds % 3600 / 60);
	const secondsPart = totalSeconds % 60;
	const record = {};
	if (hours > 0) record.hours = hours;
	if (minutes > 0) record.minutes = minutes;
	if (secondsPart > 0 || hours === 0 && minutes === 0) record.seconds = secondsPart;
	const body = getDurationFormatter(locale, style).format(record);
	if (negative) {
		if (formatRemaining) return formatRemaining(body);
		if (isDefaultLocale(locale)) return `${body} remaining`;
		return body;
	}
	return body;
}

//#endregion
export { formatTimeAsPhrase as n, secondsToIsoDuration as r, formatTime as t };
//# sourceMappingURL=format-Dhaf9oDP.js.map