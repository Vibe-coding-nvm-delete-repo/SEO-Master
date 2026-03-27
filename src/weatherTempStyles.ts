/** Convert display temperature to °C for consistent hue thresholds. */
export function celsiusFromDisplay(temp: number, unit: 'c' | 'f'): number {
  return unit === 'f' ? ((temp - 32) * 5) / 9 : temp;
}

/** Light-theme text color by “feel” (cold → hot). Input is always °C. */
export function getTemperatureHueClass(tempCelsius: number): string {
  if (tempCelsius <= 0) return 'text-sky-700';
  if (tempCelsius < 10) return 'text-sky-600';
  if (tempCelsius < 18) return 'text-emerald-700';
  if (tempCelsius < 26) return 'text-amber-700';
  if (tempCelsius < 32) return 'text-orange-700';
  return 'text-rose-700';
}
