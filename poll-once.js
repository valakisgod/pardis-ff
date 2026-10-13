// ------------------------------------------------------------------
// نسخه‌ی «یک‌باره»ی سرویسِ ربات، مخصوصِ اجرا توسطِ GitHub Actions با زمان‌بندی (cron).
// برخلافِ index.js (که یه حلقه‌ی بی‌نهایته و نیاز به سرورِ همیشه-روشن داره)، این اسکریپت
// فقط یه‌بار پیام‌های تازه رو چک می‌کنه، آگهی‌هاشون رو ذخیره می‌کنه و تموم می‌شه — هر چند
// دقیقه یه‌بار، GitHub Actions خودش دوباره اجراش می‌کنه، بدون نیاز به هیچ هاستینگِ ۲۴ساعته
// و بدون نیاز به کارتِ بانکی.
// ------------------------------------------------------------------
'use strict';

const admin = require('firebase-admin');
const { extractAds, dedupKey } = require('./ads-parser');

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

async function getOffset() {
  const snap = await metaRef.get();
  return snap.exists && snap.data().lastUpdateId ? snap.data().lastUpdateId + 1 : 0;
}

async function saveOffset(updateId) {
  await metaRef.set({ lastUpdateId: updateId, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function fetchUpdates(offset) {
  // timeout=0: بدونِ long-polling، فوری هر چی هست برمی‌گردونه (مناسبِ یه اجرای کوتاه)
  const url = `${API_BASE}/getUpdates?offset=${offset}&timeout=0`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error('getUpdates ناموفق: ' + JSON.stringify(data));
  return data.result || [];
}

async function processMessage(msg) {
  const chat = msg.chat || {};
  if (chat.type !== 'group' && chat.type !== 'supergroup') return 0;

  const text = msg.text || msg.caption || '';
  if (!text) return 0;

  const ads = extractAds(text);
  if (!ads.length) return 0;

  const batch = db.batch();
  ads.forEach((ad, i) => {
    const docId = `${chat.id}_${msg.message_id}_${i}`;
    batch.set(listingsCol.doc(docId), {
      zone: ad.zone, block: ad.block, floor: ad.floor, price: ad.price, priceText: ad.priceText,
      phone: ad.phone, direction: ad.direction, raw: ad.raw, dedupKey: dedupKey(ad),
      sourceChatId: String(chat.id), sourceChatTitle: chat.title || null, sourceMessageId: msg.message_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
  console.log(`${ads.length} آگهی از گروه «${chat.title || chat.id}» ذخیره شد.`);
  return ads.length;
}

(async () => {
  try {
    const offset = await getOffset();
    const updates = await fetchUpdates(offset);
    console.log(`${updates.length} آپدیتِ تازه دریافت شد.`);
    let total = 0;
    for (const update of updates) {
      if (update.message) {
        try { total += await processMessage(update.message); }
        catch (e) { console.error('خطا در پردازشِ پیام:', e.message); }
      }
      await saveOffset(update.update_id);
    }
    console.log(`تمام. مجموعاً ${total} آگهیِ تازه ذخیره شد.`);
    process.exit(0);
  } catch (e) {
    console.error('خطا:', e.message);
    process.exit(1);
  }
})();
