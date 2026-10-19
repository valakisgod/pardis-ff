// ------------------------------------------------------------------
// سرویسِ ربات پردیس برای «بله»: هر چند ثانیه پیام‌های تازه‌ی گروه‌هایی که ربات توشونه رو
// می‌خونه، آگهی‌های ملکی رو توشون پیدا می‌کنه (با همون منطقِ خودِ برنامه‌ی وب)، و توی
// Firestore (مجموعه‌ی bale_listings) ذخیره می‌کنه تا برنامه‌ی وب بتونه نشونشون بده.
// ------------------------------------------------------------------
'use strict';

const admin = require('firebase-admin');
const { extractAds, dedupKey } = require('./ads-parser');

// ---------- تنظیمات از متغیرهای محیطی ----------
const BOT_TOKEN = process.env.BALE_BOT_TOKEN;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const API_BASE = `https://tapi.bale.ai/bot${BOT_TOKEN}`;

if (!BOT_TOKEN) {
  console.error('خطا: متغیرِ محیطیِ BALE_BOT_TOKEN تنظیم نشده.');
  process.exit(1);
}

// ---------- راه‌اندازیِ Firebase Admin ----------
// FIREBASE_SERVICE_ACCOUNT باید محتوایِ کاملِ فایلِ JSONِ کلیدِ سرویس باشه (به‌صورتِ رشته).
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
  const url = `${API_BASE}/getUpdates?offset=${offset}&timeout=30`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) throw new Error('getUpdates ناموفق: ' + JSON.stringify(data));
  return data.result || [];
}

async function processMessage(msg) {
  const chat = msg.chat || {};
  // فقط پیام‌های گروه/سوپرگروه بررسی می‌شن، نه چت‌های خصوصی با خودِ ربات
  if (chat.type !== 'group' && chat.type !== 'supergroup') return;

  const text = msg.text || msg.caption || '';
  if (!text) return;

  const ads = extractAds(text, { sharedPhone: true });
  if (!ads.length) return;

  const batch = db.batch();
  let count = 0;
  for (let i = 0; i < ads.length; i++) {
    const ad = ads[i];
    const docId = `${chat.id}_${msg.message_id}_${i}`;
    const ref = listingsCol.doc(docId);
    batch.set(ref, {
      zone: ad.zone,
      block: ad.block,
      floor: ad.floor,
      price: ad.price,
      priceText: ad.priceText,
      phone: ad.phone,
      direction: ad.direction,
      raw: ad.raw,
      dedupKey: dedupKey(ad),
      sourceChatId: String(chat.id),
      sourceChatTitle: chat.title || null,
      sourceMessageId: msg.message_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    count++;
  }
  if (count) {
    await batch.commit();
    console.log(`[${new Date().toLocaleString('fa-IR')}] ${count} آگهی از گروه «${chat.title || chat.id}» ذخیره شد.`);
  }
}

async function pollLoop() {
  while (true) {
    try {
      const offset = await getOffset();
      const updates = await fetchUpdates(offset);
      for (const update of updates) {
        if (update.message) {
          try { await processMessage(update.message); }
          catch (e) { console.error('خطا در پردازشِ پیام:', e.message); }
        }
        await saveOffset(update.update_id);
      }
    } catch (e) {
      console.error('خطا در حلقه‌ی اصلی:', e.message);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

// یه سرورِ وبِ خیلی ساده فقط برای اینکه هاستینگ (مثلِ Render) سرویس رو «زنده» تشخیص بده
// و بشه با یه پینگِ دوره‌ای (مثلِ UptimeRobot) از خواب رفتنش جلوگیری کرد.
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('سرویسِ ربات پردیس در حالِ اجراست.');
}).listen(PORT, () => console.log(`سرورِ سلامت روی پورتِ ${PORT} بالا اومد.`));

console.log('سرویسِ ربات پردیس (بله) شروع شد...');
pollLoop();
