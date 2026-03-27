import React from 'react';

/**
 * Help for users who blocked geolocation — shown on hover/focus on the weather strip.
 * Keep copy short; light theme matches other portal tooltips.
 */
export default function WeatherLocationBlockedTooltipBody() {
  return (
    <div className="p-3 text-left">
      <div className="text-[10px] font-semibold text-zinc-800 mb-2 leading-snug">
        Enable location for local weather
      </div>
      <p className="text-[10px] text-zinc-600 leading-relaxed mb-2">
        After you allow access, reload this page so the browser can share coordinates with the app.
      </p>
      <ul className="text-[10px] text-zinc-600 space-y-2 leading-relaxed list-none pl-0">
        <li className="border-l-2 border-amber-200 pl-2">
          <span className="font-medium text-zinc-700">Chrome, Edge, Brave (Windows &amp; Mac)</span>
          <br />
          Address bar: click the <span className="font-medium">lock</span> or{' '}
          <span className="font-medium">site</span> icon → <span className="font-medium">Site settings</span> or{' '}
          <span className="font-medium">Permissions</span> → <span className="font-medium">Location</span> →{' '}
          <span className="font-medium">Allow</span>.
        </li>
        <li className="border-l-2 border-amber-200 pl-2">
          <span className="font-medium text-zinc-700">Safari (Mac)</span>
          <br />
          Menu <span className="font-medium">Safari</span> → <span className="font-medium">Settings…</span> →{' '}
          <span className="font-medium">Websites</span> → <span className="font-medium">Location</span> → set this
          site to <span className="font-medium">Allow</span>.
        </li>
        <li className="border-l-2 border-amber-200 pl-2">
          <span className="font-medium text-zinc-700">Firefox (Windows &amp; Mac)</span>
          <br />
          Click the <span className="font-medium">lock</span> in the address bar →{' '}
          <span className="font-medium">Permissions</span> → <span className="font-medium">Location</span> →{' '}
          <span className="font-medium">Allow</span> (or clear a blocked entry and reload).
        </li>
      </ul>
      <p className="text-[9px] text-zinc-400 mt-2 leading-relaxed">
        System settings: Windows — Privacy &amp; security → Location. Mac — System Settings → Privacy &amp;
        Security → Location Services (ensure the browser is allowed).
      </p>
    </div>
  );
}
