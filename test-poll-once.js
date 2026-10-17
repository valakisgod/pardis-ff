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
  console.log(`${n} بررسی، ${failures} خطا`);
  process.exit(failures ? 1 : 0);
})();
