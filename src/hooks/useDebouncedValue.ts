import { useState, useEffect, useRef } from 'react';

/**
 * Returns a debounced version of `value` that only updates after `delay` ms of quiet.
 * The raw value should be bound to the input for immediate UI feedback;
 * the debounced value should drive expensive computations (filtering, sorting).
 */
export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [value, delay]);

  return debounced;
}
