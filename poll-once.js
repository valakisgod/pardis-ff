// ------------------------------------------------------------------
// نسخه‌ی «یک‌باره»ی سرویسِ ربات، مخصوصِ اجرا توسطِ GitHub Actions با زمان‌بندی (cron).
// برخلافِ index.js (که یه حلقه‌ی بی‌نهایته و نیاز به سرورِ همیشه-روشن داره)، این اسکریپت
// فقط یه‌بار پیام‌های تازه رو چک می‌کنه، آگهی‌هاشون رو ذخیره می‌کنه، اعلانِ گوشی می‌فرسته
// (آگهیِ جدید + آلارم‌های رسیده) و تموم می‌شه — هر چند دقیقه یه‌بار، GitHub Actions خودش
// دوباره اجراش می‌کنه، بدون نیاز به هیچ هاستینگِ ۲۴ساعته و بدون نیاز به کارتِ بانکی.
// ------------------------------------------------------------------
'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { extractAds, extractBuyerRequests, findPriceDrop, dedupKey } = require('./ads-parser');
const { notifyNewAds, notifyMatches, notifyPriceDrops, notifyDueAlarms } = require('./push');

const BOT_TOKEN = process.env.BALE_BOT_TOKEN;
const API_BASE = `https://tapi.bale.ai/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
  console.error('خطا: متغیرِ محیطیِ BALE_BOT_TOKEN تنظیم نشده.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error('خطا: متغیرِ محیطیِ FIREBASE_SERVICE_ACCOUNT نامعتبره یا تنظیم نشده.', e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const metaRef = db.collection('_meta').doc('bale_bot');
const listingsCol = db.collection('bale_listings');
const buyersCol = db.collection('buyers');

async function getOffset() {
  const snap = await metaRef.get();
  return snap.exists && snap.data().lastUpdateId ? snap.data().lastUpdateId + 1 : 0;
}

async function saveOffset(updateId) {
  await metaRef.set({ lastUpdateId: updateId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

// سرورِ بله توی ایرانه و از سمتِ GitHub (آمریکا) گاهی خیلی کند جواب می‌ده؛ بدونِ سقفِ زمانی یه
// درخواستِ گیرکرده تا ~۱ دقیقه (و با قفلِ «یه اجرا در لحظه» همه‌ی اجراهای بعدی رو) معطل می‌کنه.
// پس هر تلاش سقفِ ۲۰ ثانیه داره و تا ۳ بار دوباره امتحان می‌شه.
async function fetchUpdates(offset) {
  const url = `${API_BASE}/getUpdates?offset=${offset}&timeout=0`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (!data.ok) throw new Error('getUpdates ناموفق: ' + JSON.stringify(data));
      console.log(`getUpdates (تلاشِ ${attempt}) در ${Date.now() - t0}ms جواب داد.`);
      return data.result || [];
    } catch (e) {
      lastErr = e;
      console.error(`getUpdates (تلاشِ ${attempt}) بعد از ${Date.now() - t0}ms ناموفق: ${e.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// آگهی «تازه» یعنی: نه همین سند از قبل وجود داشته (اجرای دوباره‌ی همون پیام)، و نه آگهیِ
// هم‌کلیدی (همون زون/بلوک/طبقه/قیمت/تلفن) قبلاً از یه گروهِ دیگه یا پیامِ دیگه اومده —
// تا یه فایل که چند جا تکرار می‌شه، چند اعلانِ تکراری نسازه.
async function isNewAd(docId, key) {
  const same = await listingsCol.doc(docId).get();
  if (same.exists) return false;
  const dup = await listingsCol.where('dedupKey', '==', key).limit(2).get();
  return !dup.docs.some(d => d.id !== docId);
}

// آگهی‌های قبلیِ هم‌بلوک (از آگهی‌های خودکارِ بله و فایل‌هایی که ادمین توی برنامه ثبت کرده) برای
// تشخیصِ کاهش قیمت. فقط یه فیلتر (block) می‌زنیم و بقیه‌ی شرط‌ها (زون/طبقه/جهت) توی کد چک می‌شه.
async function previousInBlock(block, selfId) {
  const out = [];
  for (const col of ['bale_listings', 'listings']) {
    const snap = await db.collection(col).where('block', '==', block).get();
    for (const d of snap.docs) if (d.id !== selfId) out.push(d.data());
  }
  return out;
}

async function processMessage(msg, newAds) {
  const chat = msg.chat || {};
  if (chat.type !== 'group' && chat.type !== 'supergroup') {
    console.log(`نادیده: پیام توی چتِ «${chat.type}» (${chat.title || chat.id}) — فقط گروه/سوپرگروه خونده می‌شه.`);
    return 0;
  }

  const text = msg.text || msg.caption || '';
  if (!text) {
    console.log(`نادیده: پیامِ بدونِ متن توی «${chat.title || chat.id}» (عکس/استیکر/...).`);
    return 0;
  }

  // پیام‌های «خریدار/خواهان» آگهیِ فروش نیستن؛ توی مجموعه‌ی buyers (همونی که برنامه‌ی وب می‌خونه)
  // ذخیره می‌شن. شناسه از روی شماره+متن ساخته می‌شه تا یه پیامِ تکراری (چند گروه / فوروارد) دوباره
  // ثبت نشه.
  let buyerCount = 0;
  for (const b of extractBuyerRequests(text)) {
    const id = 'bale_' + crypto.createHash('sha1').update((b.phone || '') + '|' + b.text.replace(/\s+/g, ' ')).digest('hex').slice(0, 24);
    const ref = buyersCol.doc(id);
    if ((await ref.get()).exists) continue;
    await ref.set({
      text: b.text, phone: b.phone, criteria: b.criteria, source: 'bale',
      sourceChatTitle: chat.title || null, createdAt: new Date().toISOString(),
    });
    buyerCount++;
  }
  if (buyerCount) console.log(`${buyerCount} خریدار از گروه «${chat.title || chat.id}» ذخیره شد.`);

  const ads = extractAds(text, { sharedPhone: true });
  if (!ads.length) {
    if (!buyerCount) console.log(`بدونِ آگهی: پیامی توی «${chat.title || chat.id}» (${text.length} نویسه) آگهیِ قابلِ‌تشخیص نداشت.`);
    return 0;
  }

  const batch = db.batch();
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const docId = `${chat.id}_${msg.message_id}_${i}`;
    const key = dedupKey(ad);
    let drop = null;
    if (await isNewAd(docId, key)) {
      if (ad.block != null && ad.floor != null && ad.price != null) {
        try { drop = findPriceDrop(ad, await previousInBlock(ad.block, docId)); }
        catch (e) { console.error('بررسیِ کاهش قیمت ناموفق بود:', e.message); }
      }
      if (drop) ad.priceDrop = drop;
      newAds.push(ad);
    }
    batch.set(listingsCol.doc(docId), {
      zone: ad.zone, block: ad.block, floor: ad.floor, price: ad.price, priceText: ad.priceText,
      phone: ad.phone, direction: ad.direction, raw: ad.raw, dedupKey: key,
      ...(drop ? { priceDrop: drop } : {}),
      sourceChatId: String(chat.id), sourceChatTitle: chat.title || null, sourceMessageId: msg.message_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  console.log(`${ads.length} آگهی از گروه «${chat.title || chat.id}» ذخیره شد.`);
  return ads.length;
}

(async () => {
  let exitCode = 0;
  try {
    const offset = await getOffset();
    const updates = await fetchUpdates(offset);
    console.log(`${updates.length} آپدیتِ تازه دریافت شد.`);
    let total = 0;
    const newAds = [];
    for (const update of updates) {
      if (update.message) {
        try { total += await processMessage(update.message, newAds); }
        catch (e) { console.error('خطا در پردازشِ پیام:', e.message); }
      } else {
        console.log(`نادیده: آپدیتِ #${update.update_id} از نوعِ ${Object.keys(update).filter(k => k !== 'update_id').join(',') || 'نامشخص'} (پیامِ معمولی نیست).`);
      }
      await saveOffset(update.update_id);
    }
    console.log(`تمام. مجموعاً ${total} آگهی ذخیره شد (${newAds.length} تا واقعاً تازه).`);

    // اعلان‌های گوشی: خطا توی این بخش نباید ذخیره‌ی آگهی‌ها رو خراب کنه.
    const messaging = admin.messaging();
    try {
      const r = await notifyNewAds(messaging, db, newAds.filter(a => !a.priceDrop));
      if (newAds.length) console.log('اعلانِ آگهیِ جدید:', JSON.stringify(r));
    } catch (e) { console.error('ارسالِ اعلانِ آگهی ناموفق بود:', e.message); }
    try {
      const r = await notifyPriceDrops(messaging, db, newAds.filter(a => a.priceDrop));
      if (!r.skipped) console.log('اعلانِ کاهش قیمت:', JSON.stringify(r));
    } catch (e) { console.error('ارسالِ اعلانِ کاهش قیمت ناموفق بود:', e.message); }
    try {
      const r = await notifyMatches(messaging, db, newAds, Date.now());
      if (!r.skipped) console.log('اعلانِ مچِ خریدار:', JSON.stringify(r));
    } catch (e) { console.error('ارسالِ اعلانِ مچِ خریدار ناموفق بود:', e.message); }
    try {
      const r = await notifyDueAlarms(messaging, db, Date.now());
      if (r.due) console.log('اعلانِ آلارم:', JSON.stringify(r));
    } catch (e) { console.error('ارسالِ اعلانِ آلارم ناموفق بود:', e.message); }
  } catch (e) {
    console.error('خطا:', e.message);
    exitCode = 1;
  }
  process.exit(exitCode);
})();
