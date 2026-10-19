// تستِ منطقِ خودِ برنامه‌ی وب (index.html) بدونِ مرورگر: توابعِ لازم از همون فایل بیرون کشیده و
// توی یه vm اجرا می‌شن. اجرا: npm run test-web
'use strict';
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('تابع پیدا نشد: ' + name);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
}
function load(names, ctx) {
  const tagDefs = html.slice(html.indexOf('const NO_LOAN_RE'), html.indexOf('];', html.indexOf('const TAG_DEFS')) + 2);
  const tagIds = html.match(/const TAG_FILTER_IDS = [^;]+;/)[0];
  const baleConsts = ['BALE_KEEP_DAYS', 'BALE_QUERY_LIMIT'].map(c => html.match(new RegExp('const ' + c + ' = [^;]+;'))[0]).join('\n') + '\n';
  const life = baleConsts + ['STALE_DAYS', 'DAY_MS', 'TEHRAN_OFFSET_MS'].map(c => html.match(new RegExp('const ' + c + ' = [^;]+;'))[0]).join('\n') + '\nlet freshOnly = false;\n';
  const consts = life + tagDefs + '\n' + tagIds + '\nlet activeTags = new Set();\n' + ['CMP_MIN_UNITS', 'CMP_SHOW_PCT'].map(c => html.match(new RegExp('const ' + c + ' = [^;]+;'))[0]).join('\n');
  const code = consts + '\nlet _blockStatsFor = null, _blockStats = null;\n' + names.map(grab).join('\n') + '\nthis.activeTags = activeTags; this.setFresh = v => { freshOnly = v; };';
  vm.createContext(ctx); vm.runInContext(code, ctx); return ctx;
}

let failures = 0, n = 0;
const assert = (c, m) => { n++; if (!c) { failures++; console.error('FAIL:', m); } };

const ctx = load(['parsePriceToMillions', 'adMatchesRule', 'describeRule', 'fsValueToJs', 'fsFieldsToObj', 'baleQueryBody', 'parseRunQuery', 'mapBaleDoc', 'mergeBale', 'lastSeenOf', 'daysSince', 'isStale', 'matchesFresh', 'staleBadgeHtml', 'timeLineHtml', 'relTime', 'tehranMidnightTimestamp', 'followUpTime', 'floorLabel', 'zoneLabel', 'followUpLabel', 'normalizeNumbers', 'normalizeChars', 'extractTags', 'displayTags', 'listingTags', 'matchesTags', 'tagsHtml', 'dedupKey', 'unitId', 'getBlockStats', 'medianOf', 'fmtMillions', 'priceVsBlock', 'cmpBadgeHtml', 'cmpDetailHtml'],
  { allListings: [], esc: x => String(x), Intl, Date, Math });
const L = (o) => Object.assign({ id: Math.random(), zone: 3, block: 12, floor: 1, direction: 'شمالی', price: 6000, phone: '0912', createdAt: '2026-10-01T00:00:00Z' }, o);
const setAll = (arr) => { ctx.allListings = arr; };   // آرایه‌ی تازه = کش باطل می‌شه، مثل mergeListingSources

// بلوک با ۴ واحدِ دیگه: میانه ۶۰۰۰
const base = [L({ floor: 2, price: 5800 }), L({ floor: 3, price: 6000 }), L({ floor: 4, price: 6200 }), L({ floor: 5, price: 6400 })];
const cheap = L({ floor: 1, price: 5100 });
setAll([...base, cheap]);
let c = ctx.priceVsBlock(cheap);
assert(c && c.median === 6100 && c.n === 4 && c.min === 5800 && c.max === 6400, 'میانه‌ی بقیه‌ی واحدها: ' + JSON.stringify(c));
assert(c.pct === -16, 'درصدِ اختلاف: ' + c.pct);
assert(ctx.cmpBadgeHtml(cheap).includes('16٪ ارزون‌تر') && ctx.cmpBadgeHtml(cheap).includes('cmp-low'), 'برچسبِ ارزون');
const pricey = L({ floor: 1, price: 7300 });
setAll([...base, pricey]);
assert(ctx.cmpBadgeHtml(pricey).includes('گران‌تر') && ctx.cmpBadgeHtml(pricey).includes('cmp-high'), 'برچسبِ گران');
const near = L({ floor: 1, price: 6100 });
setAll([...base, near]);
assert(ctx.cmpBadgeHtml(near) === '', 'نزدیکِ میانه برچسب نمی‌گیره');
assert(ctx.cmpDetailHtml(near).includes('نزدیکِ میانه'), 'ولی توی جزئیات نوشته می‌شه');

// کمتر از ۳ واحدِ دیگه → هیچ مقایسه‌ای
setAll([...base.slice(0, 2), cheap]);
assert(ctx.priceVsBlock(cheap) === null, 'با ۲ واحدِ دیگه مقایسه نشه');

// یک واحدِ تکراری (چند بار آپلود) فقط یک‌بار شمرده بشه، با قیمتِ تازه‌ترین
const rep = [L({ floor: 2, price: 9000, createdAt: '2026-09-01T00:00:00Z' }), L({ floor: 2, price: 5800, createdAt: '2026-10-05T00:00:00Z' }), ...base.slice(1)];
setAll([...rep, cheap]);
c = ctx.priceVsBlock(cheap);
assert(c.n === 4 && c.median === 6100 && c.max === 6400, 'تکراری یه‌بار و با قیمتِ تازه‌تر: ' + JSON.stringify(c));

// آرشیوشده، بدونِ بلوک، بدونِ قیمت، و بلوکِ زونِ دیگه نادیده گرفته بشن
setAll([...base, L({ floor: 6, price: 1000, archived: true }), L({ floor: 7, price: 1, zone: 4 }), L({ floor: 8, block: null }), cheap]);
c = ctx.priceVsBlock(cheap);
assert(c.n === 4 && c.min === 5800, 'آرشیو/زونِ دیگه/بدونِ بلوک حساب نشن: ' + JSON.stringify(c));
assert(ctx.priceVsBlock(L({ price: null })) === null && ctx.priceVsBlock(L({ block: null })) === null, 'بدونِ قیمت/بلوک → null');

// ---- فیلترِ برچسب‌ها ----
const T = (raw, tags) => L({ raw, tags, floor: Math.floor(Math.random() * 1e6) });
const loanFull = T('زون 3 بلوک 12 وام ب روز تخلیه ب روز', undefined);   // قدیمی: برچسبِ ذخیره‌شده ندارد
const guar = T('ضامن وام ت', ['guarantor', 'loan']);                      // جدید: برچسبِ ذخیره‌شده دارد
const plain = T('قیمت 7000', []);
assert(ctx.listingTags(loanFull).includes('loan_current') && ctx.listingTags(loanFull).includes('vacant_now'), 'فایلِ قدیمی از روی متنِ اصلی برچسب می‌گیرد');
assert(ctx.listingTags(guar).join() === 'guarantor,loan', 'برچسبِ ذخیره‌شده ملاک است');
const pass = (l) => ctx.matchesTags(l);
assert([loanFull, guar, plain].every(pass), 'بدونِ فیلتر همه رد می‌شن');
ctx.activeTags.add('loan');
assert(pass(loanFull) && pass(guar) && !pass(plain), 'فیلترِ وام‌دار');
ctx.activeTags.add('guarantor');
assert(!pass(loanFull) && pass(guar), 'دو برچسب با هم «و» می‌شن');
ctx.activeTags.clear();
ctx.activeTags.add('loan_current'); ctx.activeTags.add('vacant_now');
assert(pass(loanFull) && !pass(guar), 'وام به‌روز و تخلیه به‌روز');
assert(ctx.tagsHtml(loanFull).includes('وام به‌روز') && !ctx.tagsHtml(loanFull).includes('>وام‌دار<'), 'کارت فقط برچسبِ دقیق‌تر را نشان می‌دهد');
assert(ctx.tagsHtml(plain) === '', 'بدونِ برچسب، چیزی نشون داده نمی‌شه');
ctx.activeTags.clear();

// ---- چرخه‌ی عمر: آخرین تأیید، قدیمی، پیگیری ----
const NOW = Date.parse('2026-10-20T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
assert(ctx.daysSince(ago(3), NOW) === 3 && ctx.daysSince('نامعتبر', NOW) === null, 'محاسبه‌ی روز');
assert(ctx.isStale({ createdAt: ago(8) }, NOW) && !ctx.isStale({ createdAt: ago(6) }, NOW), 'مرزِ ۷ روز');
assert(!ctx.isStale({ createdAt: ago(30), lastSeen: ago(1) }, NOW), 'پست‌شدنِ دوباره (آخرین تأیید تازه) یعنی قدیمی نیست');
assert(ctx.isStale({ createdAt: ago(30), lastSeen: ago(9) }, NOW), 'آخرین تأییدِ قدیمی → قدیمی');
assert(!ctx.isStale({ createdAt: ago(30), status: 'فروخته شد' }, NOW) && !ctx.isStale({ createdAt: ago(30), status: 'رزرو شد' }, NOW), 'فایل با وضعیت «قدیمی» نیست');
assert(!ctx.isStale({}, NOW), 'بدونِ تاریخ قدیمی حساب نمی‌شه');
ctx.setFresh(false); assert(ctx.matchesFresh({ createdAt: ago(40) }), 'بدونِ فیلتر همه رد می‌شن');
ctx.setFresh(true);
const realNow = Date.now; 
assert(ctx.matchesFresh({ createdAt: new Date().toISOString() }) && !ctx.matchesFresh({ createdAt: ago(0 + 400) }), 'فیلترِ «فقط تازه‌ها»');
ctx.setFresh(false);
// خطِ زمانِ کارت
const once = ctx.timeLineHtml({ createdAt: new Date().toISOString(), uploadCount: 1 });
assert(once.includes('class="time"') && !once.includes('آخرین تأیید'), 'یک‌بار آپلود: زمانِ ساده');
const rep2 = ctx.timeLineHtml({ createdAt: ago(10), lastSeen: ago(1), uploadCount: 3 });
assert(rep2.includes('اولین بار') && rep2.includes('آخرین تأیید'), 'چندبار آپلود: اولین بار / آخرین تأیید');
// ساعتِ یادآوریِ پیگیری: ۱۰ صبحِ تهران (= ۰۶:۳۰ UTC)، N روز بعد، و همیشه آینده
const t1 = new Date(ctx.followUpTime(1, NOW));
assert(t1.getUTCHours() === 6 && t1.getUTCMinutes() === 30, 'ساعتِ ۱۰ تهران: ' + t1.toISOString());
assert(ctx.followUpTime(1, NOW) > NOW && ctx.followUpTime(7, NOW) - ctx.followUpTime(1, NOW) === 6 * 86400000, 'فاصله‌ی روزها');
assert(ctx.followUpLabel({ zone: 3, block: 52, floor: 1, phone: '0912' }) === 'پیگیری: زون 3 · بلوک 52 · طبقه 1 — هنوز هست؟ 0912', 'برچسبِ یادآوری: ' + ctx.followUpLabel({ zone: 3, block: 52, floor: 1, phone: '0912' }));

// ---- خواندنِ کم‌حجمِ آگهی‌های ربات ----
const body = ctx.baleQueryBody('2026-10-01T00:00:00.000Z', 500).structuredQuery;
assert(body.from[0].collectionId === 'bale_listings' && body.limit === 500 && body.where.fieldFilter.op === 'GREATER_THAN_OR_EQUAL'
  && body.where.fieldFilter.value.timestampValue === '2026-10-01T00:00:00.000Z' && body.orderBy[0].direction === 'ASCENDING', 'بدنه‌ی کوئری');
const fsDoc = (id, extra) => ({ name: 'projects/p/databases/(default)/documents/bale_listings/' + id, fields: Object.assign({
  zone: { integerValue: '3' }, block: { integerValue: '12' }, floor: { integerValue: '2' }, price: { integerValue: '6250' },
  priceText: { stringValue: '6/250' }, createdAt: { timestampValue: '2026-10-19T10:00:00Z' },
  tags: { arrayValue: { values: [{ stringValue: 'loan' }] } },
  priceDrop: { mapValue: { fields: { fromText: { stringValue: '6/500' }, toText: { stringValue: '6/250' } } } },
}, extra || {}) });
const parsed = ctx.parseRunQuery([{ readTime: 'x' }]);
assert(parsed.length === 0 && ctx.parseRunQuery(null).length === 0, 'پاسخِ خالی (فقط readTime) یعنی هیچ سندی');
const mapped = ctx.mapBaleDoc(ctx.parseRunQuery([{ document: fsDoc('abc') }, { readTime: 'y' }])[0]);
assert(mapped.id === 'bale_abc' && mapped.block === 12 && mapped.priceText === '6/250' && mapped.tags.join() === 'loan' && mapped.priceDrop.toText === '6/250' && mapped.source === 'bale', 'نگاشتِ سند: ' + JSON.stringify(mapped));
// ادغام: بدونِ تکرار، قدیمی‌ها (بیش از ۳۰ روز) حذف، و تازه‌ترین createdAt برگردد
const M = new Map(); const nowMs = Date.parse('2026-10-20T12:00:00Z');
const B = (id, iso) => ({ id, createdAt: iso });
let newest = ctx.mergeBale(M, [B('a', '2026-10-19T10:00:00Z'), B('b', '2026-10-18T10:00:00Z'), B('old', '2026-08-01T00:00:00Z')], nowMs);
assert(M.size === 2 && !M.has('old') && newest === '2026-10-19T10:00:00Z', 'قدیمی‌ها حذف و newest درست');
newest = ctx.mergeBale(M, [B('a', '2026-10-19T10:00:00Z'), B('c', '2026-10-20T08:00:00Z')], nowMs);
assert(M.size === 3 && newest === '2026-10-20T08:00:00Z', 'هم‌پوشانیِ درخواست‌ها تکرار نمی‌سازه');
newest = ctx.mergeBale(M, [], Date.parse('2026-12-31T00:00:00Z'));
assert(M.size === 0 && newest === null, 'با گذشتِ زمان کشِ قدیمی خالی می‌شه');

// ---- فیلترهای سفارشی در وب: ورودیِ قیمت، و هم‌خوانی با منطقِ ربات ----
assert(ctx.parsePriceToMillions('') === null && ctx.parsePriceToMillions('  ') === null, 'خالی = بدونِ شرط');
assert(ctx.parsePriceToMillions('7') === 7000 && ctx.parsePriceToMillions('۷') === 7000, '«7» = ۷ میلیارد');
assert(ctx.parsePriceToMillions('7/5') === 7500 && ctx.parsePriceToMillions('6/250') === 6250 && ctx.parsePriceToMillions('۶/۲۵۰') === 6250, 'قالبِ x/xxx');
assert(ctx.parsePriceToMillions('7500') === 7500 && ctx.parsePriceToMillions('950') === 950, 'عددِ میلیونی');
assert(Number.isNaN(ctx.parsePriceToMillions('abc')) && Number.isNaN(ctx.parsePriceToMillions('7/5000')), 'ورودیِ نامعتبر');
const bot = require('./ads-parser');
const rulesToTry = [
  { zones: ['3'], maxPrice: 7000, tags: ['loan'] }, { zones: [], minPrice: 5000 }, { zones: ['kuhsar'] },
  { tags: ['loan', 'guarantor'] }, {}, { zones: ['2', '3'], minPrice: 4000, maxPrice: 6000, tags: [] }, { name: 'دلخواه', zones: ['1'] },
];
const adsToTry = [{ zone: 3, price: 6500, tags: ['loan'] }, { zone: 'kuhsar', price: null, tags: [] }, { zone: 2, price: 4500, tags: ['loan', 'guarantor'] }, { zone: 1, price: 9000 }];
let parity = true;
for (const r of rulesToTry) {
  const full = Object.assign({ zones: [], minPrice: null, maxPrice: null, tags: [] }, r);
  if (ctx.describeRule(full) !== bot.describeRule(full)) { parity = false; console.error('describeRule parity:', JSON.stringify(full)); }
  for (const a of adsToTry) if (ctx.adMatchesRule(a, full) !== bot.adMatchesRule(a, full)) { parity = false; console.error('match parity:', JSON.stringify([full, a])); }
}
assert(parity, 'منطقِ فیلترِ وب و ربات باید دقیقاً یکی باشه');

// قالبِ قیمت
assert(ctx.fmtMillions(6250) === '6/250' && ctx.fmtMillions(8000) === '8/000' && ctx.fmtMillions(950) === '950', 'قالبِ قیمت');

console.log(failures ? `\n${failures} خطا از ${n}` : `همه‌ی ${n} بررسیِ منطقِ وب درسته ✅`);
process.exit(failures ? 1 : 0);
