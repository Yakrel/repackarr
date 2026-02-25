import { parseTorrentTitle, extractVersion, EXCLUDED_TYPES } from '../src/lib/server/utils.js';
import fs from 'fs';

const examples = JSON.parse(fs.readFileSync('./tests/torrent_examples.json', 'utf8'));
const allExamples = [
    ...(examples.rutracker || []), 
    ...(examples.nnm_club || []), 
    ...(examples.special_cases || []),
    ...(examples.prowlarr_auto || [])
];

console.log(`--- REPACKARR PRODUCTION LOGIC VALIDATION ---`);
console.log(`${'RAW NAME'.padEnd(50)} | ${'TITLE'.padEnd(20)} | ${'VERSION'.padEnd(15)} | ${'STATUS'}`);
console.log('-'.repeat(110));

let successCount = 0;
let versionCount = 0;
let filteredCount = 0;
let failCount = 0;

for (const raw of allExamples) {
    const title = parseTorrentTitle(raw);
    const version = extractVersion(raw);
    const isJunk = EXCLUDED_TYPES.some(p => p.test(raw));
    
    if (title) {
        successCount++;
        if (version) versionCount++;
        if (successCount <= 20) {
            console.log(`${raw.slice(0, 48).padEnd(50)} | ${title.padEnd(20)} | ${(version || 'N/A').padEnd(15)} | OK`);
        }
    } else if (isJunk || raw.length < 5) {
        filteredCount++;
    } else {
        failCount++;
        console.log(`${raw.slice(0, 48).padEnd(50)} | !!! FAILED !!!       | ${'N/A'.padEnd(15)} | ACTUAL_FAIL`);
    }
}

console.log('-'.repeat(110));
console.log(`✅ Games Extracted:   ${successCount}`);
console.log(`🔢 Versions Captured: ${versionCount} (${((versionCount/successCount)*100).toFixed(1)}% hit rate)`);
console.log(`🧹 Junk Filtered:     ${filteredCount}`);
console.log(`❌ Failures:          ${failCount}`);
console.log('-'.repeat(110));

if (failCount > 0) {
    console.error("FAIL: Production logic is inconsistent with test data.");
    process.exit(1);
} else {
    console.log("SUCCESS: Production logic is 100% verified against dataset.");
}
