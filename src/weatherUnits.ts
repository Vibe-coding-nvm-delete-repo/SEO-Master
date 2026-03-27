/**
 * Fahrenheit for United States; Celsius for Canada, EU, and everywhere else.
 * Uses IANA timezone first (Canada vs US), then `Europe/*`, then `Intl.Locale` region `US`.
 */

const CANADA_TIMEZONES = new Set<string>([
  'America/Toronto',
  'America/Vancouver',
  'America/Winnipeg',
  'America/Edmonton',
  'America/Regina',
  'America/Halifax',
  'America/St_Johns',
  'America/Moncton',
  'America/Glace_Bay',
  'America/Goose_Bay',
  'America/Blanc-Sablon',
  'America/Atikokan',
  'America/Creston',
  'America/Dawson',
  'America/Dawson_Creek',
  'America/Fort_Nelson',
  'America/Whitehorse',
  'America/Yellowknife',
  'America/Iqaluit',
  'America/Rainy_River',
  'America/Thunder_Bay',
  'America/Nipigon',
  'America/Pangnirtung',
  'America/Rankin_Inlet',
  'America/Resolute',
  'America/Cambridge_Bay',
  'America/Inuvik',
  'America/Coral_Harbour',
  'America/Churchill',
]);

/** US + territories that use US customary units for weather on TV / daily life. */
const US_TIMEZONES = new Set<string>([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Adak',
  'America/Phoenix',
  'America/Boise',
  'America/Detroit',
  'America/Kentucky/Louisville',
  'America/Kentucky/Monticello',
  'America/Indiana/Indianapolis',
  'America/Indiana/Vincennes',
  'America/Indiana/Winamac',
  'America/Indiana/Marengo',
  'America/Indiana/Petersburg',
  'America/Indiana/Vevay',
  'America/Indiana/Knox',
  'America/Menominee',
  'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem',
  'America/North_Dakota/Beulah',
  'America/Juneau',
  'America/Sitka',
  'America/Metlakatla',
  'America/Yakutat',
  'America/Nome',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'America/St_Thomas',
  'Pacific/Guam',
  'Pacific/Saipan',
  'Pacific/Pago_Pago',
  'Pacific/Wake',
  'Pacific/Midway',
]);

/**
 * True only when the device timezone is a known US (+territories) zone.
 * Other regions (EU, Canada, Mexico, etc.) use °C even if the browser language is `en-US`.
 */
export function shouldUseFahrenheit(timeZone: string): boolean {
  if (CANADA_TIMEZONES.has(timeZone)) return false;
  if (US_TIMEZONES.has(timeZone)) return true;
  if (timeZone.startsWith('Europe/')) return false;
  return false;
}
