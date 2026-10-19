// تستِ سریعِ ads-parser.js با متنِ نمونه‌ای شبیهِ چیزی که توی گروه‌های بله فوروارد می‌شه،
// بدونِ نیاز به اتصال به اینترنت یا Firebase. اجرا: npm run test-parser
const { extractAds } = require('./ads-parser');

const sample = `
💥💥💥💥💥
زون4
بلوک7
طبقه7 ش ش
قیمت : 7,800 صافی
09194101244
💥💥💥💥💥

💢💢💢💢💢💢💢💢
زون 2
بلوک 50
طبقه 3 جنوبی
قیمت 4500
09120000009
💢💢💢💢💢💢💢💢

نخلستان ۴ فاز۲
زون 1
بلوک 10
قیمت 3000
09120000000
`;

const ads = extractAds(sample);
console.log(`${ads.length} آگهی پیدا شد:\n`);
for (const ad of ads) {
  console.log(JSON.stringify(ad, null, 2));
}

let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } }

// این دقیقاً همون منطقِ splitIntoRecords/extractAdsِ خودِ pardis-live.html هست (بدون هیچ تغییری).
// چون «فاز۲» و «زون 1» این‌جا روی خط‌های جدا و هر دو به‌عنوانِ «نشانه‌ی شروعِ رکوردِ تازه»
// دیده می‌شن، متن به‌خاطرِ همین رفتارِ تفکیکِ رکوردها به ۲ تکه می‌شکنه: یکی فقط «نخلستان۴ فاز۲»
// (که چون فاز غیرِ۱۱ـه رد می‌شه) و یکی «زون 1 / بلوک 10 / ...» که دیگه اشاره‌ای به فاز۲ نداره و
// قبول می‌شه — دقیقاً همون چیزی که خودِ برنامه‌ی وب هم با این متن انجام می‌ده.
assert(ads.length === 3, 'باید ۳ آگهی پیدا بشه، فعلاً: ' + ads.length);
assert(ads.some(a => a.zone === 4 && a.block === 7 && a.phone === '09194101244'), 'آگهیِ زون۴/بلوک۷ باید درست پارس بشه');
assert(ads.some(a => a.zone === 2 && a.block === 50 && a.priceText === '4500'), 'آگهیِ زون۲/بلوک۵۰ باید درست پارس بشه');
assert(ads.some(a => a.zone === 1 && a.block === 10), 'آگهیِ زون۱/بلوک۱۰ هم باید پیدا بشه (رفتارِ طبیعیِ تفکیکِ رکوردها)');

// ---- پیامِ چندآگهیِ یک‌نفره (عین گروهِ بله): تلفن فقط آخرِ پیام، قیمتِ بعضی‌ها فقط یه عددِ تنها ----
const G = '✅✅✅✅✅✅';
const multi = `با سلام خدمت همکاران محترم
خریدار 5 مورد واحد فاز11
تمامی طبقات
نیما
09193929104
${G}
زون ۴ ش
ب ۹۳
ط ۱۱ ش غ
فول تمیز ویودار
مدارک ب نام
8
${G}
زون ۳
ب ۴۴
ط ۱۴ ش غ
ضامن
مدارک ب نام
7
${G}
زون ۲
ب ۱۳۱
ط ۱۴ ج ش
مدارک ب نام
5/۴۰۰
${G}
زون ۳
ب ۵۲
ط ۱ ش
۳۰ ورودی ت
مدارک ب نام
۶/۲۵۰
${G}
09193929104
نیما`;
const m = extractAds(multi, { sharedPhone: true });
assert(m.length === 4, 'پیامِ چندآگهی باید ۴ آگهیِ جدا بده، فعلاً: ' + m.length);
assert(m.every(a => a.phone === '09193929104'), 'تلفنِ آخرِ پیام باید به همه‌ی آگهی‌ها برسه');
assert(m[0].block === 93 && m[0].price === 8000 && m[0].priceText === '8', 'قیمتِ تک‌عددیِ «8» = ۸ میلیارد');
assert(m[1].block === 44 && m[1].price === 7000 && m[1].priceText === '7', 'قیمتِ تک‌عددیِ «7» = ۷ میلیارد');
assert(m[2].price === 5400 && m[3].price === 6250, 'قیمت‌های x/xxx دست‌نخورده بمونن');
assert(new Set(m.map(a => a.raw)).size === 4, 'متنِ اصلیِ هر آگهی جدا و قاطی‌نشده باشه');

// دو شمارهٔ متفاوت توی یه پیام → هیچ‌کدوم به آگهی‌های بی‌تلفن داده نشه
const twoPhones = `زون 3\nبلوک 10\n09121111111\n\n\nزون 2\nبلوک 20\n\n\nزون 1\nبلوک 30\n09122222222`;
const tp = extractAds(twoPhones, { sharedPhone: true });
assert(tp.find(a => a.block === 20).phone === null, 'با دو شمارهٔ متفاوت، تلفن نباید حدس زده بشه');

// عددِ تنهایی که قیمتِ دیگه‌ای کنارش هست، جای قیمتِ واقعی رو نگیره
const both = extractAds(`زون 3\nبلوک 12\n9\n7/350`);
assert(both[0].priceText === '7/350', 'قیمتِ x/xxx باید بر عددِ تنها اولویت داشته باشه');

// ---- خریدار: استخراجِ معیار و تطبیق ----
const { extractBuyerRequests, buyerCriteria, adMatchesBuyer } = require('./ads-parser');
const br = extractBuyerRequests(multi);
assert(br.length === 1 && br[0].phone === '09193929104', 'سرِ پیامِ «خریدار ۵ مورد…» باید یه خریدار باشه، نه آگهی');
assert(br[0].criteria.zones.length === 0 && br[0].criteria.maxPrice === null, '«فاز11» نباید زون حساب بشه: ' + JSON.stringify(br[0].criteria));
assert(!adMatchesBuyer(m[0], br[0].criteria), 'خریدارِ بدونِ معیار هیچ‌چیز رو مچ نکنه');
const c1 = buyerCriteria('خریدار زون ۲ و ز ۳ حداکثر ۶/۵ میلیارد');
assert(c1.zones.sort().join() === '2,3' && c1.maxPrice === 6500, 'چند زون و سقفِ قیمت: ' + JSON.stringify(c1));
assert(adMatchesBuyer({ zone: 3, price: 6000 }, c1) && !adMatchesBuyer({ zone: 4, price: 6000 }, c1) && !adMatchesBuyer({ zone: 3, price: 7000 }, c1), 'قانونِ تطبیق (زون و سقف)');
assert(adMatchesBuyer({ zone: 2, price: null }, c1), 'آگهیِ بدونِ قیمت فقط با زون مچ بشه');
assert(buyerCriteria('خریدار فاز ۲ و ۳').zones.length === 0, '«فاز ۲» زون نیست');

// ---- کاهش قیمت ----
const { findPriceDrop } = require('./ads-parser');
const unit = (o) => Object.assign({ zone: 3, block: 52, floor: 1, direction: 'شمالی', price: 6500, priceText: '6/500' }, o);
let d = findPriceDrop(unit({ price: 6250, priceText: '6/250' }), [unit()]);
assert(d && d.from === 6500 && d.to === 6250 && d.fromText === '6/500' && d.toText === '6/250', 'کاهش قیمتِ همون واحد: ' + JSON.stringify(d));
assert(findPriceDrop(unit({ price: 6500 }), [unit()]) === null, 'قیمتِ برابر کاهش نیست');
assert(findPriceDrop(unit({ price: 7000 }), [unit()]) === null, 'افزایش قیمت کاهش نیست');
assert(findPriceDrop(unit({ price: 6250 }), [unit({ direction: 'جنوبی' })]) === null, 'جهتِ متفاوت = واحدِ دیگه');
assert(findPriceDrop(unit({ price: 6250 }), [unit({ floor: 2 })]) === null, 'طبقه‌ی متفاوت = واحدِ دیگه');
assert(findPriceDrop(unit({ price: 6250 }), [unit({ zone: 4 })]) === null, 'زونِ متفاوت = واحدِ دیگه');
assert(findPriceDrop(unit({ price: 6250, floor: null }), [unit({ floor: null })]) === null, 'طبقه‌ی نامشخص → تشخیص نمی‌دیم');
assert(findPriceDrop(unit({ price: 6800 }), [unit({ price: 6500 }), unit({ price: 7000 })]) === null, 'از کمترینِ قبلی مقایسه می‌شه، نه از بالاترین');
assert(findPriceDrop(unit({ price: 6000 }), [unit({ price: 7000 }), unit({ price: 6500, priceText: '6/500' })]).from === 6500, 'مبنا کمترین قیمتِ قبلیه');
assert(findPriceDrop(unit({ price: null }), [unit()]) === null, 'آگهیِ بدونِ قیمت');

console.log(failures ? `\n${failures} خطا` : '\nهمه چی درسته ✅');
process.exit(failures ? 1 : 0);
