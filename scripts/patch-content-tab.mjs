const fs = require('fs');
let s = fs.readFileSync('src/ContentTab.tsx', 'utf8');
const oldImports = `import React, { useState, useCallback, useMemo } from 'react';
import { GenerateTabInstance, PromptSlotConfig, ExternalViewTab } from './GenerateTab';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';`;
const newImports = `import React, { useState, useCallback, useMemo } from 'react';
import { GenerateTabInstance, PromptSlotConfig, ExternalViewTab } from './GenerateTab';
import { UPSTREAM_PAGE_NAMES_DOC_ID, H2_PIPELINE_SETTINGS_DOC_ID, buildH2ContentRowsFromFirestore } from './contentPipelineH2';`;
if (!s.includes(oldImports)) {
  console.error('oldImports block not found');
  process.exit(1);
}
s = s.replace(oldImports, newImports);
const dupStart = s.indexOf('/**\n * Parse H2 names from the h2names slot output.');
if (dupStart === -1) {
  console.error('dupStart not found');
  process.exit(1);
}
const dupEnd = s.indexOf('// ============ ContentTab ============', dupStart);
if (dupEnd === -1) {
  console.error('dupEnd not found');
  process.exit(1);
}
s = s.slice(0, dupStart) + s.slice(dupEnd);
fs.writeFileSync('src/ContentTab.tsx', s);
console.log('ContentTab patched, removed', dupEnd - dupStart, 'chars');
