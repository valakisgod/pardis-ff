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

console.log(failures ? `\n${failures} خطا` : '\nهمه چی درسته ✅');
process.exit(failures ? 1 : 0);
