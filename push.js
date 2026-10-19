// ------------------------------------------------------------------
// ارسالِ اعلانِ گوشی (Firebase Cloud Messaging) برای آگهیِ جدید و یادآوری (آلارم).
// منطقِ «چی بفرستیم» این‌جا جداست (بدونِ نیاز به Firebase) تا بشه تستش کرد؛
// poll-once.js فقط ازش استفاده می‌کنه.
// ------------------------------------------------------------------
'use strict';

const APP_URL = 'https://valakisgod.github.io/pardis-ff/';
const MAX_TOKENS_PER_BATCH = 500;       // سقفِ FCM برای هر درخواستِ گروهی
const ALARM_MAX_AGE_MS = 6 * 60 * 60 * 1000; // آلارمی که بیشتر از ۶ ساعت پیش رسیده دیگه فرستاده نمی‌شه
const PUSHED_ALARM_IDS_KEEP = 300;

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
// (عمداً «invalid-argument» اینجا نیست: اون خطا ممکنه از خودِ پیام باشه، نه توکن، و نباید
// باعثِ پاک‌شدنِ همه‌ی توکن‌ها بشه.)

function zoneLabel(z) {
  if (z === 'kuhsar') return 'کوهسار';
  if (z === 'ghadir') return 'غدیر';
  return 'زون ' + z;
}

function describeAd(ad) {
  const parts = [zoneLabel(ad.zone)];
  if (ad.block != null) parts.push('بلوک ' + ad.block);
  if (ad.floor != null) parts.push(ad.floor === 0 ? 'همکف' : 'طبقه ' + ad.floor);
  if (ad.direction) parts.push(ad.direction);
  if (ad.price != null) parts.push(Number(ad.price).toLocaleString('en-US'));
  return parts.join(' · ');
}

// همه‌ی آگهی‌های تازه‌ی یک اجرا → یک اعلان (نه یکی برای هر آگهی، که گوشی رو پر کنه).
function buildNewAdsPayload(newAds) {
  if (!newAds.length) return null;
  if (newAds.length === 1) {
    return {
      type: 'ad',
      title: '🏠 آگهی جدید',
      body: describeAd(newAds[0]),
      tag: 'pardis-new-ads',
      url: APP_URL,
    };
  }
  const shown = newAds.slice(0, 3).map(describeAd);
  const rest = newAds.length - shown.length;
  return {
    type: 'ad',
    title: `🏠 ${newAds.length} آگهی جدید`,
    body: shown.join('\n') + (rest > 0 ? `\nو ${rest} آگهیِ دیگه` : ''),
    tag: 'pardis-new-ads',
    url: APP_URL,
  };
}

// آلارم‌هایی که زمانشون رسیده، هنوز توی برنامه زنگ نخوردن (firedAt ندارن) و قبلاً اعلانشون
// فرستاده نشده.
function dueAlarms(items, pushedIds, nowMs) {
  const pushed = new Set(pushedIds || []);
  return (items || []).filter(a => {
    if (!a || !a.id || !a.time || a.firedAt || pushed.has(a.id)) return false;
    const t = new Date(a.time).getTime();
    if (isNaN(t)) return false;
    return t <= nowMs && nowMs - t <= ALARM_MAX_AGE_MS;
  });
}

function buildAlarmPayload(alarm) {
  return {
    type: 'alarm',
    title: '⏰ یادآوری',
    body: alarm.label ? String(alarm.label) : 'زمانِ یادآوری‌ات رسید.',
    tag: 'pardis-alarm-' + alarm.id,
    url: APP_URL,
  };
}

// فیلترهای سفارشی: هر آگهیِ تازه با قانون‌ها مقایسه می‌شه. آگهیِ مچ‌شده با (حداقل) یک قانون با «اعلانِ
// همون قانون» خبر داده می‌شه و دیگه توی اعلانِ عمومی/کاهش‌قیمت تکرار نمی‌شه.
function matchRules(newAds, rules) {
  const { adMatchesRule } = require('./ads-parser');
  const byRule = new Map(); const matched = new Set();
  (rules || []).forEach((rule, i) => {
    const hit = newAds.filter(a => adMatchesRule(a, rule));
    if (hit.length) { byRule.set(i, hit); hit.forEach(a => matched.add(a)); }
  });
  return { byRule, matched };
}

function buildRulePayload(rule, ads) {
  const { describeRule } = require('./ads-parser');
  const label = describeRule(rule);
  const line = a => (a.priceDrop ? '📉 ' : '') + describeAd(a) + (a.priceDrop ? ` (از ${a.priceDrop.fromText})` : '');
  const shown = ads.slice(0, 3).map(line); const rest = ads.length - shown.length;
  return {
    type: 'rule',
    title: `🔔 ${label}` + (ads.length > 1 ? ` · ${ads.length} آگهی` : ''),
    body: shown.join('\n') + (rest > 0 ? `\nو ${rest} آگهیِ دیگه` : ''),
    tag: 'pardis-rule-' + (rule.id || label),
    url: APP_URL,
  };
}

async function loadRules(db) {
  const snap = await db.collection('events').doc('alert_rules').get();
  return snap.exists ? (snap.data().items || []) : [];
}

async function notifyRules(messaging, db, byRule, rules) {
  if (!byRule.size) return { ok: 0, dead: 0, skipped: 'no-matches' };
  const docs = await getTokenDocs(db, 'ads');
  if (!docs.length) return { ok: 0, dead: 0, skipped: 'no-tokens' };
  let ok = 0, dead = 0;
  for (const [i, ads] of byRule) {
    const r = await sendToTokens(messaging, db, docs, buildRulePayload(rules[i], ads));
    ok += r.ok; dead += r.dead;
  }
  return { ok, dead, rules: byRule.size };
}

// کاهش قیمتِ یه واحد (ad.priceDrop = {fromText, toText}) → یک اعلانِ جمع‌وجور
function describeUnit(ad) {
  const parts = [zoneLabel(ad.zone)];
  if (ad.block != null) parts.push('بلوک ' + ad.block);
  if (ad.floor != null) parts.push(ad.floor === 0 ? 'همکف' : 'طبقه ' + ad.floor);
  if (ad.direction) parts.push(ad.direction);
  return parts.join(' · ');
}

function buildDropPayload(drops) {
  if (!drops.length) return null;
  const line = a => `${describeUnit(a)} · از ${a.priceDrop.fromText} به ${a.priceDrop.toText}`;
  const shown = drops.slice(0, 3).map(line);
  const rest = drops.length - shown.length;
  return {
    type: 'drop',
    title: drops.length === 1 ? '📉 کاهش قیمت' : `📉 ${drops.length} کاهش قیمت`,
    body: shown.join('\n') + (rest > 0 ? `\nو ${rest} موردِ دیگه` : ''),
    tag: 'pardis-drops',
    url: APP_URL,
  };
}

async function notifyPriceDrops(messaging, db, drops) {
  const payload = buildDropPayload(drops);
  if (!payload) return { ok: 0, dead: 0, skipped: 'no-drops' };
  const docs = await getTokenDocs(db, 'ads');
  if (!docs.length) return { ok: 0, dead: 0, skipped: 'no-tokens' };
  return sendToTokens(messaging, db, docs, payload);
}

// مچ‌های «آگهیِ تازه ↔ خریدار»: matches = [{ ad, buyers: [{phone,...}] }] → یک اعلانِ جمع‌وجور.
function buildMatchPayload(matches) {
  if (!matches.length) return null;
  const line = m => {
    const who = m.buyers.length === 1 ? (m.buyers[0].phone || 'بدون شماره') : `${m.buyers.length} خریدار`;
    return `${describeAd(m.ad)} ← ${who}`;
  };
  const shown = matches.slice(0, 3).map(line);
  const rest = matches.length - shown.length;
  return {
    type: 'match',
    title: matches.length === 1 ? '🙋 یک فایل به درد خریدار می‌خوره' : `🙋 ${matches.length} فایل به درد خریدار می‌خوره`,
    body: shown.join('\n') + (rest > 0 ? `\nو ${rest} موردِ دیگه` : ''),
    tag: 'pardis-matches',
    url: APP_URL,
  };
}

function toFcmMessage(payload, tokens) {
  // فقط «data» می‌فرستیم (بدونِ کلیدِ notification) تا خودِ service worker اعلان رو بسازه و
  // بتونه لرزش/ماندگاریِ آلارم رو تنظیم کنه. همه‌ی مقدارها باید رشته باشن.
  const data = {};
  for (const [k, v] of Object.entries(payload)) data[k] = String(v);
  return {
    tokens,
    data,
    webpush: { headers: { Urgency: 'high', TTL: payload.type === 'alarm' ? '3600' : '86400' } },
  };
}

// messaging: admin.messaging()؛ db: admin.firestore() — هر دو تزریق می‌شن تا تست‌پذیر باشه.
async function sendToTokens(messaging, db, tokenDocs, payload) {
  const tokens = tokenDocs.map(d => d.id);
  let ok = 0, dead = 0;
  for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_BATCH) {
    const chunk = tokens.slice(i, i + MAX_TOKENS_PER_BATCH);
    const res = await messaging.sendEachForMulticast(toFcmMessage(payload, chunk));
    const deadRefs = [];
    res.responses.forEach((r, idx) => {
      if (r.success) { ok++; return; }
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) deadRefs.push(chunk[idx]);
      else console.error('ارسالِ اعلان ناموفق:', code || (r.error && r.error.message));
    });
    for (const t of deadRefs) { await db.collection('push_tokens').doc(t).delete(); dead++; }
  }
  return { ok, dead };
}

async function getTokenDocs(db, field) {
  const snap = await db.collection('push_tokens').where(field, '==', true).get();
  return snap.docs;
}

async function notifyNewAds(messaging, db, newAds) {
  const payload = buildNewAdsPayload(newAds);
  if (!payload) return { ok: 0, dead: 0, skipped: 'no-ads' };
  const docs = await getTokenDocs(db, 'ads');
  if (!docs.length) return { ok: 0, dead: 0, skipped: 'no-tokens' };
  return sendToTokens(messaging, db, docs, payload);
}

// آگهی‌های تازه رو با خریدارهای «فعال» (تا ۳۰ روزِ اخیر) تطبیق می‌ده؛ تطبیق با adMatchesBuyer.
// خریدارِ بدونِ criteria (مثلاً از برنامه‌ی وب) از روی متنش معیار می‌گیره.
const BUYER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
async function notifyMatches(messaging, db, newAds, nowMs) {
  if (!newAds.length) return { ok: 0, dead: 0, skipped: 'no-ads' };
  const { buyerCriteria, adMatchesBuyer } = require('./ads-parser');
  // فقط خریدارهای ۳۰ روزِ اخیر خونده می‌شن (نه کلِ مجموعه) تا هر اجرا خواندنِ کمی داشته باشه
  const since = new Date(nowMs - BUYER_MAX_AGE_MS).toISOString();
  const snap = await db.collection('buyers').where('createdAt', '>=', since).get();
  const buyers = snap.docs.map(d => d.data()).map(b => ({ phone: b.phone || null, criteria: b.criteria || buyerCriteria(b.text) }));
  const matches = [];
  for (const ad of newAds) {
    const hit = buyers.filter(b => adMatchesBuyer(ad, b.criteria));
    if (hit.length) matches.push({ ad, buyers: hit });
  }
  const payload = buildMatchPayload(matches);
  if (!payload) return { ok: 0, dead: 0, skipped: 'no-matches' };
  const docs = await getTokenDocs(db, 'ads');
  if (!docs.length) return { ok: 0, dead: 0, skipped: 'no-tokens' };
  return sendToTokens(messaging, db, docs, payload);
}

async function notifyDueAlarms(messaging, db, nowMs) {
  const alarmsSnap = await db.collection('events').doc('alarms').get();
  const items = alarmsSnap.exists ? (alarmsSnap.data().items || []) : [];
  const pushedRef = db.collection('_meta').doc('pushed_alarms');
  const pushedSnap = await pushedRef.get();
  const pushedIds = pushedSnap.exists ? (pushedSnap.data().ids || []) : [];
  const due = dueAlarms(items, pushedIds, nowMs);
  if (!due.length) return { sent: 0 };
  const docs = await getTokenDocs(db, 'alarms');
  let sent = 0;
  for (const a of due) {
    if (docs.length) { const r = await sendToTokens(messaging, db, docs, buildAlarmPayload(a)); sent += r.ok; }
  }
  // حتی اگه هیچ‌کس مشترک نبود، علامت می‌زنیم تا بعداً که کسی مشترک شد، آلارمِ قدیمی نرسه.
  const ids = [...pushedIds, ...due.map(a => a.id)].slice(-PUSHED_ALARM_IDS_KEEP);
  await pushedRef.set({ ids }, { merge: true });
  return { sent, due: due.length };
}

module.exports = {
  APP_URL, describeAd, buildNewAdsPayload, buildMatchPayload, notifyMatches, buildDropPayload, notifyPriceDrops, matchRules, buildRulePayload, loadRules, notifyRules, dueAlarms, buildAlarmPayload, toFcmMessage,
  sendToTokens, notifyNewAds, notifyDueAlarms,
};
