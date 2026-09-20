import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('notion-speaking-materials.js', 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const materials = context.window.IELTS_DAILY_MATERIALS;

assert.equal(materials.length, 100, 'material count');
assert.deepEqual(Array.from(materials, x => x.day), Array.from({ length: 100 }, (_, i) => i + 1), 'Day1-Day100 order');
for (const item of materials) {
  for (const key of ['topic', 'vlogger', 'difficulty', 'videoTitle']) assert.ok(item[key], `Day${item.day} ${key}`);
  for (const key of ['notionUrl', 'videoUrl']) assert.match(item[key], /^https:\/\//, `Day${item.day} ${key}`);
}

const start = new Date('2026-09-20T00:00:00Z');
const schedule = Array.from({ length: 50 }, (_, offset) => ({
  date: new Date(start.getTime() + offset * 86400000).toISOString().slice(0, 10),
  days: Array.from(materials.slice(offset * 2, offset * 2 + 2), x => x.day),
}));
assert.deepEqual(schedule[0], { date: '2026-09-20', days: [1, 2] });
assert.deepEqual(schedule.at(-1), { date: '2026-11-08', days: [99, 100] });

const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
assert.match(html, /DAILY_MATERIAL_START='2026-09-20'/);
assert.match(html, /data-material="daily100"/);
assert.match(html, /\.\/notion-speaking-materials\.js/);
assert.match(sw, /\.\/notion-speaking-materials\.js/);

console.log('Notion schedule verified: Day1-100, two per day, 2026-09-20 to 2026-11-08.');
