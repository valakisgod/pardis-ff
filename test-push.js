// تستِ منطقِ اعلان‌ها (push.js) بدونِ اتصال به Firebase. اجرا: npm run test-push
'use strict';
const assert = require('assert');
const push = require('./push');

let n = 0;
function t(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('✓', name); }); }

// ---------- پیامِ آگهی ----------
const ad = (o) => Object.assign({ zone: 3, block: 12, floor: 2, price: 5200, direction: 'جنوبی' }, o);

(async () => {
  await t('یک آگهی: عنوانِ مفرد و خلاصه‌ی آگهی', () => {
    const p = push.buildNewAdsPayload([ad()]);
    assert.strictEqual(p.title, '🏠 آگهی جدید');
    assert.strictEqual(p.body, 'زون 3 · بلوک 12 · طبقه 2 · جنوبی · 5,200');
    assert.strictEqual(p.type, 'ad');
  });
  await t('بدونِ آگهی: هیچ پیامی ساخته نمی‌شه', () => assert.strictEqual(push.buildNewAdsPayload([]), null));
  await t('همکف و کوهسار/غدیر درست نوشته می‌شن', () => {
    assert.ok(push.describeAd(ad({ floor: 0 })).includes('همکف'));
    assert.ok(push.describeAd(ad({ zone: 'kuhsar' })).startsWith('کوهسار'));
    assert.ok(push.describeAd(ad({ zone: 'ghadir', block: null })).startsWith('غدیر'));
  });
  await t('چند آگهی: یک اعلان با شمارش، فقط ۳ تا نشون داده می‌شه', () => {
    const p = push.buildNewAdsPayload([1, 2, 3, 4, 5].map(i => ad({ block: i })));
    assert.strictEqual(p.title, '🏠 5 آگهی جدید');
    assert.strictEqual(p.body.split('\n').length, 4);
    assert.ok(p.body.endsWith('و 2 آگهیِ دیگه'));
  });
  await t('پیامِ FCM فقط data داره و همه‌ی مقدارها رشته‌اند', () => {
    const m = push.toFcmMessage(push.buildNewAdsPayload([ad()]), ['t1']);
    assert.ok(!m.notification);
    assert.ok(Object.values(m.data).every(v => typeof v === 'string'));
    assert.deepStrictEqual(m.tokens, ['t1']);
    assert.strictEqual(m.webpush.headers.Urgency, 'high');
  });

  // ---------- آلارم ----------
  const NOW = Date.parse('2026-10-17T12:00:00Z');
  const al = (id, minAgo, extra) => Object.assign({ id, time: new Date(NOW - minAgo * 60000).toISOString(), label: 'تماس با مشتری', firedAt: null }, extra);
  await t('آلارمِ رسیده و نزده، انتخاب می‌شه', () => assert.deepStrictEqual(push.dueAlarms([al('a', 3)], [], NOW).map(a => a.id), ['a']));
  await t('آلارمِ آینده انتخاب نمی‌شه', () => assert.strictEqual(push.dueAlarms([al('a', -30)], [], NOW).length, 0));
  await t('آلارمی که توی برنامه زنگ خورده (firedAt) انتخاب نمی‌شه', () => assert.strictEqual(push.dueAlarms([al('a', 3, { firedAt: 'x' })], [], NOW).length, 0));
  await t('آلارمی که قبلاً فرستاده شده دوباره نمی‌ره', () => assert.strictEqual(push.dueAlarms([al('a', 3)], ['a'], NOW).length, 0));
  await t('آلارمِ خیلی قدیمی (بیش از ۶ ساعت) نمی‌ره', () => assert.strictEqual(push.dueAlarms([al('a', 7 * 60)], [], NOW).length, 0));
  await t('ورودیِ خراب کرش نمی‌ده', () => assert.strictEqual(push.dueAlarms([null, {}, { id: 'x', time: 'bad' }], [], NOW).length, 0));
  await t('پیامِ آلارم: برچسب یا متنِ پیش‌فرض', () => {
    assert.strictEqual(push.buildAlarmPayload(al('a', 1)).body, 'تماس با مشتری');
    assert.strictEqual(push.buildAlarmPayload(al('a', 1, { label: '' })).body, 'زمانِ یادآوری‌ات رسید.');
    assert.strictEqual(push.buildAlarmPayload(al('a', 1)).type, 'alarm');
  });

  // ---------- ارسال + پاک‌سازیِ توکنِ مرده ----------
  function fakeDb(initial) {
    const store = JSON.parse(JSON.stringify(initial || {}));
    const deleted = [];
    const col = (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: store[name + '/' + id] !== undefined, data: () => store[name + '/' + id] }),
        set: async (d, o) => { store[name + '/' + id] = o && o.merge ? Object.assign({}, store[name + '/' + id], d) : d; },
        delete: async () => { deleted.push(id); delete store[name + '/' + id]; },
      }),
      where: (f, op, v) => ({ get: async () => ({ docs: Object.entries(store).filter(([k, d]) => k.startsWith(name + '/') && d[f] === v).map(([k]) => ({ id: k.split('/')[1] })) }) }),
    });
    return { collection: col, store, deleted };
  }
  function fakeMessaging(failing) {
    const sent = [];
    return {
      sent,
      sendEachForMulticast: async (msg) => { sent.push(msg); return { responses: msg.tokens.map(tk => failing[tk] ? { success: false, error: { code: failing[tk] } } : { success: true }) }; },
    };
  }

  await t('آگهیِ جدید: فقط به مشترک‌های «ads» می‌ره، توکنِ مرده پاک می‌شه', async () => {
    const db = fakeDb({ 'push_tokens/A': { ads: true }, 'push_tokens/B': { ads: true }, 'push_tokens/C': { alarms: true } });
    const m = fakeMessaging({ B: 'messaging/registration-token-not-registered' });
    const r = await push.notifyNewAds(m, db, [ad()]);
    assert.deepStrictEqual(m.sent[0].tokens, ['A', 'B']);
    assert.strictEqual(r.ok, 1); assert.strictEqual(r.dead, 1);
    assert.deepStrictEqual(db.deleted, ['B']);
  });
  await t('خطای «invalid-argument» توکن‌ها رو پاک نمی‌کنه', async () => {
    const db = fakeDb({ 'push_tokens/A': { ads: true } });
    const m = fakeMessaging({ A: 'messaging/invalid-argument' });
    const origErr = console.error; console.error = () => {};
    await push.notifyNewAds(m, db, [ad()]);
    console.error = origErr;
    assert.deepStrictEqual(db.deleted, []);
  });
  await t('بدونِ مشترک یا بدونِ آگهی، چیزی نمی‌ره', async () => {
    const m = fakeMessaging({});
    assert.strictEqual((await push.notifyNewAds(m, fakeDb({}), [ad()])).skipped, 'no-tokens');
    assert.strictEqual((await push.notifyNewAds(m, fakeDb({ 'push_tokens/A': { ads: true } }), [])).skipped, 'no-ads');
    assert.strictEqual(m.sent.length, 0);
  });
  await t('بیش از ۵۰۰ توکن در چند دسته فرستاده می‌شه', async () => {
    const init = {}; for (let i = 0; i < 1100; i++) init['push_tokens/T' + i] = { ads: true };
    const m = fakeMessaging({});
    await push.notifyNewAds(m, fakeDb(init), [ad()]);
    assert.deepStrictEqual(m.sent.map(x => x.tokens.length), [500, 500, 100]);
  });
  await t('آلارم: به مشترک‌های «alarms» می‌ره و دوباره نمی‌ره', async () => {
    const db = fakeDb({
      'events/alarms': { items: [al('a1', 2), al('a2', -20)] },
      'push_tokens/A': { alarms: true }, 'push_tokens/B': { ads: true },
    });
    const m = fakeMessaging({});
    const r1 = await push.notifyDueAlarms(m, db, NOW);
    assert.strictEqual(r1.due, 1); assert.deepStrictEqual(m.sent[0].tokens, ['A']);
    assert.strictEqual(m.sent[0].data.type, 'alarm');
    const r2 = await push.notifyDueAlarms(m, db, NOW);
    assert.strictEqual(r2.sent, 0); assert.strictEqual(m.sent.length, 1);
    assert.deepStrictEqual(db.store['_meta/pushed_alarms'].ids, ['a1']);
  });
  await t('آلارم بدونِ مشترک هم علامت می‌خوره (که بعداً قدیمی نرسه)', async () => {
    const db = fakeDb({ 'events/alarms': { items: [al('a1', 2)] } });
    const m = fakeMessaging({});
    await push.notifyDueAlarms(m, db, NOW);
    assert.strictEqual(m.sent.length, 0);
    assert.deepStrictEqual(db.store['_meta/pushed_alarms'].ids, ['a1']);
  });
  await t('سندِ آلارم وجود نداشته باشه، خطا نمی‌ده', async () => {
    const r = await push.notifyDueAlarms(fakeMessaging({}), fakeDb({}), NOW);
    assert.strictEqual(r.sent, 0);
  });

  console.log(`\nهمه‌ی ${n} تست درسته ✅`);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
