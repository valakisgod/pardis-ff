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
  const consts = tagDefs + '\n' + tagIds + '\nlet activeTags = new Set();\n' + ['CMP_MIN_UNITS', 'CMP_SHOW_PCT'].map(c => html.match(new RegExp('const ' + c + ' = [^;]+;'))[0]).join('\n');
  const code = consts + '\nlet _blockStatsFor = null, _blockStats = null;\n' + names.map(grab).join('\n') + '\nthis.activeTags = activeTags;';
  vm.createContext(ctx); vm.runInContext(code, ctx); return ctx;
}

let failures = 0, n = 0;
const assert = (c, m) => { n++; if (!c) { failures++; console.error('FAIL:', m); } };

const ctx = load(['normalizeNumbers', 'normalizeChars', 'extractTags', 'displayTags', 'listingTags', 'matchesTags', 'tagsHtml', 'dedupKey', 'unitId', 'getBlockStats', 'medianOf', 'fmtMillions', 'priceVsBlock', 'cmpBadgeHtml', 'cmpDetailHtml'],
  { allListings: [], esc: x => String(x) });
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

// قالبِ قیمت
assert(ctx.fmtMillions(6250) === '6/250' && ctx.fmtMillions(8000) === '8/000' && ctx.fmtMillions(950) === '950', 'قالبِ قیمت');

console.log(failures ? `\n${failures} خطا از ${n}` : `همه‌ی ${n} بررسیِ منطقِ وب درسته ✅`);
process.exit(failures ? 1 : 0);
