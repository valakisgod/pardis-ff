// تستِ مسیرِ کاملِ poll-once.js با Firebase Admin و APIِ بله‌ی فیک (اجرا: npm run test-poll): ذخیره‌ی آگهی، تشخیصِ «تازه»،
// ارسالِ اعلان، آلارم، و اینکه خطای اعلان ذخیره‌ی آگهی‌ها رو خراب نکنه.
const Module = require('module');
const path = require('path');
const REPO = __dirname;

let failures = 0, n = 0;
const assert = (c, m) => { n++; if (!c) { failures++; console.error('FAIL:', m); } };

function run({ store, updates, tokensFail }) {
  return new Promise((resolve) => {
    const sent = []; const log = []; const errs = [];
    const fake = {
      initializeApp() {}, credential: { cert: (x) => x },
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => '<ts>' } }),
      messaging: () => ({ sendEachForMulticast: async (m) => { if (tokensFail) throw new Error('fcm down'); sent.push(m); return { responses: m.tokens.map(() => ({ success: true })) }; } }),
    };
    const snap = (p) => ({ id: p.split('/').pop(), exists: store[p] !== undefined, data: () => store[p] });
    const colApi = (name) => ({
      doc: (id) => ({ get: async () => snap(name + '/' + id), set: async (d, o) => { store[name + '/' + id] = o && o.merge ? Object.assign({}, store[name + '/' + id], d) : d; }, delete: async () => { delete store[name + '/' + id]; } }),
      get: async () => ({ docs: Object.keys(store).filter(k => k.startsWith(name + '/')).map(snap) }),
      where: (f, op, v) => ({ limit: () => ({ get: async () => ({ docs: Object.keys(store).filter(k => k.startsWith(name + '/') && store[k][f] === v).map(snap) }) }), get: async () => ({ docs: Object.keys(store).filter(k => k.startsWith(name + '/') && store[k][f] === v).map(snap) }) }),
    });
    const db = { collection: colApi, batch: () => { const ops = []; return { set: (ref, d, o) => ops.push([ref, d, o]), commit: async () => { for (const [ref, d, o] of ops) await ref.set(d, o); } }; } };
    const origLoad = Module._load;
    Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : origLoad.call(this, req, ...rest); };
    process.env.BALE_BOT_TOKEN = 'TKN'; process.env.FIREBASE_SERVICE_ACCOUNT = '{"a":1}';
    global.fetch = async () => ({ json: async () => ({ ok: true, result: updates }) });
    const origExit = process.exit, origLog = console.log, origErr = console.error;
    console.log = (...a) => log.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' '));
    process.exit = (code) => { process.exit = origExit; console.log = origLog; console.error = origErr; Module._load = origLoad; resolve({ code, sent, log, errs, store }); };
    delete require.cache[path.join(REPO, 'poll-once.js')]; delete require.cache[path.join(REPO, 'push.js')];
    require(path.join(REPO, 'poll-once.js'));
  });
}

const msg = (id, uid, text, chatId = -100) => ({ update_id: uid, message: { message_id: id, chat: { id: chatId, type: 'group', title: 'گروه تست' }, text } });
const AD1 = 'زون 3\nبلوک 12\nطبقه 2 جنوبی\nقیمت 5200\n09121234567';
const AD2 = 'زون 4\nبلوک 7\nطبقه 7 ش ش\nقیمت 7800\n09194101244';

(async () => {
  // ۱) دو آگهیِ تازه → یک اعلان، با یک مشترکِ ads و یکی alarms
  {
    const store = { 'push_tokens/A': { ads: true }, 'push_tokens/B': { alarms: true } };
    const r = await run({ store, updates: [msg(1, 10, AD1), msg(2, 11, AD2)] });
    assert(r.code === 0, 'کد خروج ۰: ' + r.code + ' ' + r.errs.join('|'));
    assert(Object.keys(store).filter(k => k.startsWith('bale_listings/')).length === 2, 'دو آگهی ذخیره شود');
    assert(r.sent.length === 1 && r.sent[0].tokens.join() === 'A', 'یک اعلان فقط برای مشترکِ ads: ' + JSON.stringify(r.sent.map(s => s.tokens)));
    assert(r.sent[0].data.title.includes('2 آگهی'), 'عنوانِ جمع: ' + r.sent[0].data.title);
    assert(store['_meta/bale_bot'].lastUpdateId === 11, 'offset ذخیره شود');
  }
  // ۲) همان آگهی دوباره از گروهِ دیگر (هم‌کلید) → ذخیره می‌شود ولی اعلانِ تکراری نمی‌رود
  {
    const store = { 'push_tokens/A': { ads: true } };
    await run({ store, updates: [msg(1, 10, AD1)] });
    const r = await run({ store, updates: [msg(5, 12, AD1, -200)] });
    assert(Object.keys(store).filter(k => k.startsWith('bale_listings/')).length === 2, 'نسخه‌ی گروهِ دوم هم ذخیره شود');
    assert(r.sent.length === 0, 'آگهیِ تکراری اعلان نسازد، فرستاده‌ها: ' + r.sent.length);
  }
  // ۳) همان پیام دوباره پردازش شود (ری‌استارت) → اعلانِ تکراری نه
  {
    const store = { 'push_tokens/A': { ads: true } };
    await run({ store, updates: [msg(1, 10, AD1)] });
    const r = await run({ store, updates: [msg(1, 10, AD1)] });
    assert(r.sent.length === 0, 'پردازشِ دوباره‌ی همان پیام اعلان نسازد');
  }
  // ۴) خطای FCM → آگهی‌ها ذخیره شوند و اجرا موفق باشد
  {
    const store = { 'push_tokens/A': { ads: true } };
    const r = await run({ store, updates: [msg(1, 10, AD1)], tokensFail: true });
    assert(r.code === 0, 'خطای اعلان نباید اجرا رو شکست‌خورده کند: ' + r.code);
    assert(Object.keys(store).some(k => k.startsWith('bale_listings/')), 'آگهی باید ذخیره شده باشد');
    assert(r.errs.some(e => e.includes('اعلان')), 'خطا لاگ شود: ' + r.errs.join('|'));
  }
  // ۵) آلارمِ رسیده بدونِ هیچ پیامِ جدید
  {
    const store = {
      'push_tokens/B': { alarms: true },
      'events/alarms': { items: [{ id: 'z1', time: new Date(Date.now() - 120000).toISOString(), label: 'زنگ بزن', firedAt: null }] },
    };
    const r = await run({ store, updates: [] });
    assert(r.sent.length === 1 && r.sent[0].data.type === 'alarm' && r.sent[0].data.body === 'زنگ بزن', 'اعلانِ آلارم برود');
    const r2 = await run({ store, updates: [] });
    assert(r2.sent.length === 0, 'آلارم دوباره نرود');
  }
  // ۶) پیامِ بی‌آگهی / چتِ خصوصی
  {
    const store = { 'push_tokens/A': { ads: true } };
    const r = await run({ store, updates: [msg(1, 10, 'سلام، حالتون چطوره؟'), { update_id: 11, message: { message_id: 2, chat: { id: 5, type: 'private' }, text: AD1 } }] });
    assert(r.sent.length === 0 && !Object.keys(store).some(k => k.startsWith('bale_listings/')), 'نه ذخیره نه اعلان');
  }
  // ۷) پیامِ «خریدار»: توی buyers ذخیره بشه (نه آگهی)، بار دوم تکراری نشه، و آگهیِ تازه با خریدارِ مناسب مچ و اعلان بشه
  {
    const BUYER = 'خریدار زون 3 تا 6/500\n09125550000';
    const store = { 'push_tokens/A': { ads: true } };
    const r1 = await run({ store, updates: [msg(1, 10, BUYER)] });
    const buyerKeys = () => Object.keys(store).filter(k => k.startsWith('buyers/'));
    assert(buyerKeys().length === 1, 'یک خریدار ذخیره شود');
    const b = store[buyerKeys()[0]];
    assert(b.phone === '09125550000' && b.criteria.zones.join() === '3' && b.criteria.maxPrice === 6500 && b.source === 'bale', 'معیارِ خریدار: ' + JSON.stringify(b));
    assert(!Object.keys(store).some(k => k.startsWith('bale_listings/')), 'خریدار نباید آگهی حساب بشه');
    assert(r1.sent.length === 0, 'خودِ ثبتِ خریدار اعلان نسازد');
    await run({ store, updates: [msg(2, 11, BUYER, -300)] });
    assert(buyerKeys().length === 1, 'همان خریدار از گروهِ دیگر دوباره ثبت نشود');
    // آگهیِ هم‌زون و زیرِ سقف → مچ
    const r2 = await run({ store, updates: [msg(3, 12, 'زون 3\nبلوک 12\nقیمت 5200\n09121234567')] });
    const match = r2.sent.find(m => m.data.type === 'match');
    assert(match && match.data.body.includes('09125550000'), 'اعلانِ مچِ خریدار برود: ' + JSON.stringify(r2.sent.map(m => m.data)));
    // آگهیِ بالاتر از سقف یا زونِ دیگه → مچ نه
    const r3 = await run({ store, updates: [msg(4, 13, 'زون 3\nبلوک 20\nقیمت 9000\n09121234568'), msg(5, 14, 'زون 4\nبلوک 21\nقیمت 5000\n09121234569')] });
    assert(!r3.sent.some(m => m.data.type === 'match'), 'گرون‌تر از سقف / زونِ دیگه مچ نشود');
  }
  // ۸) کاهش قیمتِ همون واحد → سند priceDrop می‌گیره و فقط اعلانِ «کاهش قیمت» (نه «آگهی جدید») می‌ره
  {
    const U = (price, extra = '') => `زون 3\nبلوک 12\nطبقه 2 جنوبی\nقیمت ${price}\n0912123${extra || '4567'}`;
    const store = { 'push_tokens/A': { ads: true } };
    await run({ store, updates: [msg(1, 10, U(6500))] });
    const r = await run({ store, updates: [msg(2, 11, U(6250, '4568'), -222)] });
    const dropDoc = Object.keys(store).map(k => store[k]).find(v => v.priceDrop);
    assert(dropDoc && dropDoc.priceDrop.from === 6500 && dropDoc.priceDrop.to === 6250, 'priceDrop روی سند ذخیره شود: ' + JSON.stringify(dropDoc && dropDoc.priceDrop));
    assert(r.sent.length === 1 && r.sent[0].data.type === 'drop' && r.sent[0].data.body.includes('از 6500 به 6250'), 'فقط اعلانِ کاهش قیمت: ' + JSON.stringify(r.sent.map(m => m.data)));
    // دوباره‌پستِ قیمتِ قدیمی (بالاتر) → کاهش نیست، اعلانِ «آگهی جدید» هم نه چون هم‌کلید با آگهیِ اولیه‌ست
    const r2 = await run({ store, updates: [msg(3, 12, U(6500, '4569'), -333)] });
    assert(!r2.sent.some(m => m.data.type === 'drop'), 'قیمتِ بالاتر کاهش نیست');
    // فایلی که ادمین توی برنامه ثبت کرده (مجموعه‌ی listings) هم مبنای مقایسه‌ست
    const store2 = { 'push_tokens/A': { ads: true }, 'listings/x': { zone: 3, block: 12, floor: 2, direction: 'جنوبی', price: 7000, priceText: '7000' } };
    const r3 = await run({ store: store2, updates: [msg(1, 10, U(6400))] });
    assert(r3.sent.some(m => m.data.type === 'drop' && m.data.body.includes('از 7000 به 6400')), 'مقایسه با فایل‌های دستی هم انجام شود');
  }
  console.log(`${n} بررسی، ${failures} خطا`);
  process.exit(failures ? 1 : 0);
})();
