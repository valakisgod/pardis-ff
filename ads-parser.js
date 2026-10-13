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
  const push = cur => { if (cur.length) records.push({ lines: cur.map(x => x.n), raw: trimSeparatorLines(cur.map(x => x.o)).join('\n') }); };
  for (const b of blocks) {
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

function extractAds(rawText) {
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
    const { price, priceText } = parsePrice(joined);
    let direction = null;
    for (const [re, label] of dirMap) { if (re.test(joined)) { direction = label; break; } }
    const zoneVal = isKuhsar ? 'kuhsar' : (isGhadirOnly ? 'ghadir' : +zm[1]);
    ads.push({ zone: zoneVal, block: bm ? +bm[1] : null, floor, price, priceText, phone: phm ? phm[1] : null, direction, raw: rec.raw });
  }
  return ads;
}

function dedupKey(l) {
  return [l.zone, l.block, l.floor ?? 'x', l.price ?? 'x', l.phone ?? 'x'].join('|');
}

module.exports = { extractAds, splitIntoRecords, parsePrice, dedupKey };
