// ------------------------------------------------------------------
// همون منطقِ تشخیصِ آگهی که توی pardis-live.html استفاده می‌شه، عیناً پورت‌شده
// به Node.js تا سرویسِ ربات دقیقاً همون‌طوری آگهی‌ها رو تشخیص بده که خودِ برنامه می‌ده.
// ------------------------------------------------------------------
'use strict';

function normalizeNumbers(text) {
  const fa = '۰۱۲۳۴۵۶۷۸۹', ar = '٠١٢٣٤٥٦٧٨٩';
  return text.replace(/[۰-۹٠-٩]/g, ch => {
    let i = fa.indexOf(ch); if (i === -1) i = ar.indexOf(ch);
    return i === -1 ? ch : String(i);
  });
}

function normalizeChars(text) {
  return text
    .replace(/[‌‍‎‏]/g, ' ')
    .replace(/[ً-ْ]/g, '')
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک');
}

const zoneRe = /(?:زون|ز|ض|ظ|ذ|z)\s*[:\-]?\s*([1-5])(?!\d)/i;
const kuhsarRe = /کوهسار/;
const ghadirOnlyRe = /غدیر/;
const blockRe = /(?:بلوک|بلاک|ب)\s*[:\-]?\s*(\d{1,3})(?!\d)/i;
const floorRe = /(?:طبقه|ط)\s*[:\-]?\s*(\d{1,2})(?!\d)/i;
const groundFloorRe = /هم\s*کف/i;
const priceSlashRe = /(?<!\d)(\d{1,2})\s*[/.,]\s*(\d{3})(?!\d)/;
const priceFlatRe = /(?<!\d)(\d{4,5})(?!\d)/;
const phoneRe = /(0?9\d{9})/;
const letterBoundary = '(?<![آ-ی])%s(?![آ-ی])';
const phase11Re = /فاز\s*[:\-]?\s*(?:11|یازده)(?!\d)|(?<![آ-ی])ف(?![آ-ی])\s*[:\-]?\s*11(?!\d)/i;
const phaseAnyRe = /(?:فاز|(?<![آ-ی])ف(?![آ-ی]))\s*[:\-]?\s*(\d{1,2}|یازده)(?!\d)/gi;
const buyerRe = /خریدار|خواهان|خرید\s*داریم|خریداریم|متقاضی|مشتری\s*دارم/;
const dirMap = [
  [/جنوب\s*غرب|ج\s*غ/, 'جنوب‌غربی'], [/جنوب\s*شرق|ج\s*ش/, 'جنوب‌شرقی'],
  [/شمال\s*غرب|ش\s*غ/, 'شمال‌غربی'], [/شمال\s*شرق|ش\s*ش/, 'شمال‌شرقی'],
  [/شمال/, 'شمالی'], [/جنوب/, 'جنوبی'], [/شرق/, 'شرقی'], [/غرب/, 'غربی'],
  [new RegExp(letterBoundary.replace('%s', 'ش')), 'شمالی'],
  [new RegExp(letterBoundary.replace('%s', 'ج')), 'جنوبی'],
  [new RegExp(letterBoundary.replace('%s', 'غ')), 'غربی'],
];

function trimSeparatorLines(lines) {
  const hasContent = l => /[\p{L}\p{N}]/u.test(l);
  let a = 0, b = lines.length;
  while (a < b && !hasContent(lines[a])) a++;
  while (b > a && !hasContent(lines[b - 1])) b--;
  return lines.slice(a, b);
}

function splitIntoRecords(rawText) {
  const originalLines = rawText.replace(/\r\n/g, '\n').split('\n');
  let normalizedLines = normalizeNumbers(normalizeChars(rawText)).replace(/\r\n/g, '\n').split('\n');
  if (normalizedLines.length !== originalLines.length) normalizedLines = originalLines;

  const blocks = []; let block = []; let blankRun = 0;
  for (let i = 0; i < normalizedLines.length; i++) {
    const line = normalizedLines[i].trim();
    if (!line) {
      blankRun++;
      if (blankRun >= 2 && block.length) { blocks.push(block); block = []; }
    } else {
      blankRun = 0; block.push({ n: line, o: originalLines[i].trim() });
    }
  }
  if (block.length) blocks.push(block);

  const records = [];
  let blockIndex = -1;
  const push = cur => { if (cur.length) records.push({ lines: cur.map(x => x.n), raw: trimSeparatorLines(cur.map(x => x.o)).join('\n'), blockIndex }); };
  for (const b of blocks) {
    blockIndex++;
    let current = []; let hasMarker = false;
    for (const item of b) {
      const isMarker = zoneRe.test(item.n) || phaseAnyRe.test(item.n);
      phaseAnyRe.lastIndex = 0;
      if (isMarker && hasMarker) { push(current); current = []; hasMarker = false; }
      current.push(item); if (isMarker) hasMarker = true;
    }
    push(current);
  }
  return records;
}

function parsePrice(text) {
  const slash = text.match(priceSlashRe);
  if (slash) return { price: parseInt(slash[1]) * 1000 + parseInt(slash[2].padEnd(3, '0')), priceText: slash[0].replace(/\s+/g, '') };
  const flat = text.match(priceFlatRe);
  if (flat) return { price: parseInt(flat[1]), priceText: flat[1] };
  return { price: null, priceText: null };
}

// قیمتِ «تک‌عددی»: بعضی‌ها قیمت رو فقط به‌صورت یه عددِ تنها (۱ یا ۲ رقمی، به میلیارد) توی یه خط
// می‌نویسن (مثل «8» یا «7») — یعنی ۸ یا ۷ میلیارد = ۸۰۰۰ یا ۷۰۰۰ میلیون. فقط وقتی استفاده می‌شه که
// هیچ قیمتِ دیگه‌ای (x/xxx یا ۴-۵ رقمی) توی آگهی پیدا نشده باشه، و آخرین خطِ تک‌عددی انتخاب می‌شه.
function parseLonePrice(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^(\d{1,2})$/);
    if (m && +m[1] > 0) return { price: +m[1] * 1000, priceText: m[1] };
  }
  return { price: null, priceText: null };
}

function extractAds(rawText, opts = {}) {
  const records = splitIntoRecords(rawText);
  const ads = [];
  for (const rec of records) {
    const joined = rec.lines.join(' ');
    if (buyerRe.test(joined)) continue;

    const isKuhsar = kuhsarRe.test(joined);
    const isGhadirOnly = !isKuhsar && ghadirOnlyRe.test(joined);
    const isGhadir = isKuhsar || isGhadirOnly;

    if (!isGhadir) {
      const mentionedPhases = [...joined.matchAll(phaseAnyRe)].map(m => m[1]);
      const mentionsOtherPhase = mentionedPhases.some(p => p !== '11' && p !== 'یازده');
      const mentionsPhase11 = phase11Re.test(joined);
      if (mentionsOtherPhase && !mentionsPhase11) continue;
    }

    const zm = joined.match(zoneRe);
    if (!isGhadir && !zm) continue;
    const bm = joined.match(blockRe);

    const fm = joined.match(floorRe); const phm = joined.match(phoneRe);
    const floor = fm ? +fm[1] : (groundFloorRe.test(joined) ? 0 : null);
    let { price, priceText } = parsePrice(joined);
    if (price == null) ({ price, priceText } = parseLonePrice(rec.lines));
    let direction = null;
    for (const [re, label] of dirMap) { if (re.test(joined)) { direction = label; break; } }
    const zoneVal = isKuhsar ? 'kuhsar' : (isGhadirOnly ? 'ghadir' : +zm[1]);
    ads.push({ zone: zoneVal, block: bm ? +bm[1] : null, floor, price, priceText, phone: phm ? phm[1] : null, direction, raw: rec.raw, _blockIndex: rec.blockIndex });
  }

  // چند فایل پشتِ‌سرِهم توی یه پیام، و فقط آخرِ همه‌شون یه‌بار شماره‌تلفن (برای همه‌ی فایل‌ها).
  // فایلی که شماره نداره، اگه توی همون گروه دقیقاً یه شماره‌ی منحصربه‌فرد باشه همون رو می‌گیره؛
  // اگه چند شماره‌ی متفاوت بود دست نمی‌زنیم. گروه = «بلوک» (پاراگرافِ بین دو خط خالی)، مگر این‌که
  // opts.sharedPhone باشه (ربات: یه پیام = یه نفر، پس کلِ پیام یه گروهه).
  const groups = new Map();
  for (const ad of ads) {
    const k = opts.sharedPhone ? 0 : ad._blockIndex;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(ad);
  }
  for (const group of groups.values()) {
    const distinct = [...new Set(group.map(a => a.phone).filter(Boolean))];
    if (distinct.length === 1) for (const ad of group) if (!ad.phone) ad.phone = distinct[0];
  }
  for (const ad of ads) delete ad._blockIndex;
  return ads;
}

function dedupKey(l) {
  return [l.zone, l.block, l.floor ?? 'x', l.price ?? 'x', l.phone ?? 'x'].join('|');
}

// ----------------------------------------------------------------------
// کاهش قیمت: یه «واحد» رو با (زون، بلوک، طبقه، جهت) می‌شناسیم — قیمت توش نیست، پس همون واحد با
// قیمتِ جدید «یه آگهیِ دیگه برای همون واحد» حساب می‌شه. اگه قیمتِ تازه از کمترین قیمتیِ که قبلاً
// برای همون واحد دیده شده کمتر باشه، کاهش قیمته. (کمترین، نه آخرین: تا یه فایلِ قدیمیِ دوباره‌پست‌شده
// با قیمتِ بالاتر، بعداً یه «کاهشِ کاذب» نسازه.) بلوک/طبقه‌ی نامشخص → تشخیص نمی‌دیم.
// prevDocs: آگهی‌های قبلیِ هم‌بلوک (هر منبعی)؛ هر کدوم {zone, block, floor, direction, price, priceText}.
// ----------------------------------------------------------------------
function sameUnit(a, b) {
  return a.block != null && a.floor != null
    && String(a.zone) === String(b.zone) && a.block === b.block && a.floor === b.floor
    && (a.direction || null) === (b.direction || null);
}

function findPriceDrop(ad, prevDocs) {
  if (ad.price == null) return null;
  let low = null;
  for (const d of prevDocs) {
    if (d.price == null || !sameUnit(ad, d)) continue;
    if (low === null || d.price < low.price) low = d;
  }
  if (!low || ad.price >= low.price) return null;
  return { from: low.price, to: ad.price, fromText: low.priceText || String(low.price), toText: ad.priceText || String(ad.price) };
}

// ----------------------------------------------------------------------
// خریدارها: پیام‌هایی که کلمه‌ی خریدار/خواهان/... دارن، آگهیِ فروش نیستن؛ جدا ذخیره می‌شن
// (مجموعه‌ی buyers، همون که برنامه‌ی وب می‌خونه) و برای تطبیقِ خودکار با آگهی‌های تازه
// معیارهایی ازشون درمیاد: زون(ها) و سقفِ قیمت. فقط همین دو تا «شرطِ سخت» هستن؛ چیزی که
// مشخص نشده، یعنی «فرقی نمی‌کنه».
// ----------------------------------------------------------------------
function extractBuyerRequests(rawText) {
  const requests = [];
  for (const rec of splitIntoRecords(rawText)) {
    const joined = rec.lines.join(' ');
    if (!buyerRe.test(joined)) continue;
    const phm = joined.match(phoneRe);
    requests.push({ text: rec.raw, phone: phm ? phm[1] : null, criteria: buyerCriteria(rec.raw) });
  }
  return requests;
}

function buyerCriteria(text) {
  const norm = normalizeNumbers(normalizeChars(text || ''));
  // «فاز ۲» و مشابهش نباید به‌عنوان «زون ۲» خونده بشه
  const noPhase = norm.replace(phaseAnyRe, ' ');
  phaseAnyRe.lastIndex = 0;
  const zones = new Set();
  for (const m of noPhase.matchAll(new RegExp(zoneRe.source, 'gi'))) zones.add(m[1]);
  if (kuhsarRe.test(norm)) zones.add('kuhsar');
  if (ghadirOnlyRe.test(norm) && !kuhsarRe.test(norm)) zones.add('ghadir');

  // سقفِ قیمت: «تا ۷» / «حداکثر ۶/۵» / «بودجه ۸» (میلیارد) یا یه قیمتِ معمولی توی متن
  let maxPrice = null;
  const upTo = norm.match(/(?:تا|حداکثر|سقف|بودجه)\s*:?\s*(\d{1,2})(?:\s*[/.]\s*(\d{1,3}))?(?!\d)/);
  if (upTo) maxPrice = +upTo[1] * 1000 + (upTo[2] ? parseInt(upTo[2].padEnd(3, '0')) : 0);
  else {
    const { price } = parsePrice(norm);
    if (price != null) maxPrice = price;
  }
  return { zones: [...zones], maxPrice };
}

// آگهی با معیارِ خریدار می‌خونه؟ خریدارِ بدونِ هیچ معیار هیچ‌وقت مچ نمی‌شه (وگرنه همه‌چی مچ می‌شد).
function adMatchesBuyer(ad, criteria) {
  if (!criteria) return false;
  const zones = criteria.zones || [];
  const hasMax = criteria.maxPrice != null;
  if (!zones.length && !hasMax) return false;
  if (zones.length && !zones.includes(String(ad.zone))) return false;
  if (hasMax && ad.price != null && ad.price > criteria.maxPrice) return false;
  return true;
}

module.exports = { extractAds, splitIntoRecords, parsePrice, dedupKey, extractBuyerRequests, buyerCriteria, adMatchesBuyer, sameUnit, findPriceDrop };
