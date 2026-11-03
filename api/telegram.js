'use strict';
// Telegram webhook: lets the admin add/remove people who receive uploaded files.
//  - Anyone who presses Start sends a request; the admin gets ✅ / ❌ buttons.
//  - Admin menu: «➕ Yangi foydalanuvchi» (send ID or @username), «👥 Ro'yxat».
//  - The owner («katta admin», env TELEGRAM_ADMIN_ID) also appoints assistant admins («👮 Admin tayinlash», «🛡 Adminlar»;
//    user, 2 Nov 2026). An assistant admin receives the files and may approve requests and add people while the owner is away,
//    but never removes anyone and cannot appoint admins; the owner is told about every person an assistant adds.
// A bot can only message (and resolve the @username of) people who pressed
// Start in it, so new people must press Start first.
// Register the webhook once with /api/telegram-setup?key=MINAR_APP_KEY.
const store = require('../lib/bot-store');
const phone = require('../lib/phone-code');

const BTN_ADD = '➕ Yangi foydalanuvchi';
const BTN_LIST = "👥 Ro'yxat";
const BTN_CANCEL = '✖️ Bekor qilish';
const BTN_ADMIN = '👮 Admin tayinlash';
const BTN_ADMINS = '🛡 Adminlar';
const MENU = { keyboard: [[{ text: BTN_ADD }, { text: BTN_LIST }]], resize_keyboard: true, is_persistent: true };
const OWNER_MENU = { keyboard: [[{ text: BTN_ADD }, { text: BTN_LIST }], [{ text: BTN_ADMIN }, { text: BTN_ADMINS }]], resize_keyboard: true, is_persistent: true };

async function tg(method, params) {
  const r = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json().catch(() => null);
}

const send = (chat, text, extra) => tg('sendMessage', Object.assign({ chat_id: chat, text }, extra || {}));

function person(u) {
  return {
    id: String(u.id),
    username: u.username || '',
    name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id),
  };
}

function label(p) { return p.name + (p.username ? ' (@' + p.username + ')' : '') + ' — ' + p.id; }

const isOwner = (id) => store.admins().includes(String(id));
const isHelper = (state, id) => (state.helpers || []).some((h) => h.id === String(id));
const isAdmin = (state, id) => isOwner(id) || isHelper(state, id);
const menuFor = (id) => (isOwner(id) ? OWNER_MENU : MENU);
// Everyone who handles requests: owners and assistant admins.
const allAdmins = (state) => [...new Set([...store.admins(), ...(state.helpers || []).map((h) => h.id)])];
const isRecipient = (state, id) => store.envChats().includes(String(id)) || state.recipients.some((r) => r.id === String(id));

function remember(state, p) {
  state.seen = state.seen.filter((s) => s.id !== p.id);
  state.seen.unshift(p);
  state.seen = state.seen.slice(0, 300);
}

function findKnown(state, id) {
  return [...state.pending, ...state.seen, ...state.recipients].find((x) => x.id === String(id));
}

async function addRecipient(state, p, by) {
  if (isRecipient(state, p.id)) return false;
  state.recipients.push(Object.assign({}, p, { added: new Date().toISOString(), by: String(by) }));
  state.pending = state.pending.filter((x) => x.id !== p.id);
  await store.save(state);
  await send(p.id, "✅ Siz qo'shildingiz. Endi Minar dasturida yuklangan yangi fayllar sizga ham keladi.").catch(() => {});
  if (!isOwner(by)) {
    const h = findKnown(state, by);
    for (const o of store.admins()) await send(o, 'ℹ️ Admin ' + (h ? label(h) : by) + " qo'shdi: " + label(p)).catch(() => {});
  }
  return true;
}

async function appointHelper(state, p, by) {
  state.helpers = state.helpers || [];
  if (isOwner(p.id) || isHelper(state, p.id)) return false;
  state.helpers.push(Object.assign({}, p, { added: new Date().toISOString(), by: String(by) }));
  // an assistant admin also receives the files («kim fayl yuklasa ko'rsin»)
  if (!isRecipient(state, p.id)) state.recipients.push(Object.assign({}, p, { added: new Date().toISOString(), by: String(by) }));
  state.pending = state.pending.filter((x) => x.id !== p.id);
  await store.save(state);
  await send(p.id, "👮 Siz Minar botida admin etib tayinlandingiz.\n\nYuklangan fayllar sizga keladi. Siz yangi so'rovlarni tasdiqlashingiz va " +
    BTN_ADD + " orqali odam qo'shishingiz mumkin. O'chirish va admin tayinlash faqat katta adminda.", { reply_markup: MENU }).catch(() => {});
  return true;
}

async function sendAdmins(chat, state) {
  const owners = store.admins().map((id) => { const k = findKnown(state, id); return '• ' + (k ? label(k) : id) + ' (katta admin)'; });
  const helpers = (state.helpers || []).map((h) => '• ' + label(h));
  const kb = (state.helpers || []).map((h) => [{ text: '❌ Adminlikdan olish: ' + h.name, callback_data: 'unadm:' + h.id }]);
  await send(chat, '🛡 Adminlar:\n\n' + owners.concat(helpers).join('\n') + (helpers.length ? '' : "\n\nYordamchi admin hali yo'q. Tayinlash: " + BTN_ADMIN),
    kb.length ? { reply_markup: { inline_keyboard: kb } } : { reply_markup: OWNER_MENU });
}

async function sendList(chat, state) {
  const owner = isOwner(chat);
  const fixed = store.envChats().map((id) => {
    const k = findKnown(state, id);
    return '• ' + (k ? label(k) : id) + ' (asosiy)';
  });
  const added = state.recipients.map((r) => '• ' + label(r));
  const text = "👥 Fayl oluvchilar ro'yxati:\n\n" + fixed.concat(added).join('\n') +
    (owner && state.recipients.length ? "\n\nO'chirish uchun pastdagi tugmani bosing." : '');
  const kb = owner ? state.recipients.map((r) => [{ text: "❌ O'chirish: " + r.name, callback_data: 'del:' + r.id }]) : [];
  await send(chat, text, kb.length ? { reply_markup: { inline_keyboard: kb } } : { reply_markup: menuFor(chat) });
}

async function adminMessage(state, m) {
  const chat = String(m.chat.id);
  const text = (m.text || '').trim();

  if (text === '/start' || text === '/menu') {
    delete state.awaiting[chat];
    await store.save(state);
    if (isOwner(chat)) await send(chat, "Salom! Siz katta adminsiz.\n\n" + BTN_ADD + " — yangi odam qo'shish\n" + BTN_LIST + " — kimlarga fayl borishini ko'rish va o'chirish\n" +
      BTN_ADMIN + " — yordamchi admin tayinlash (u odam qo'sha oladi, o'chira olmaydi)\n" + BTN_ADMINS + " — adminlar ro'yxati", { reply_markup: OWNER_MENU });
    else await send(chat, "Salom! Siz yordamchi adminsiz.\n\n" + BTN_ADD + " — yangi odam qo'shish\n" + BTN_LIST + " — kimlarga fayl borishini ko'rish\n\nO'chirish va admin tayinlash faqat katta adminda.", { reply_markup: MENU });
    return;
  }
  if (isOwner(chat) && (text === BTN_ADMIN || text === '/admin')) {
    state.awaiting[chat] = 'admin';
    await store.save(state);
    await send(chat, "Admin qilinadigan odamning Telegram ID raqamini yoki @username'ini yuboring.\n\n" +
      "U odam qo'sha oladi va fayllarni oladi, lekin hech kimni o'chira olmaydi va admin tayinlay olmaydi.\n⚠️ U avval botga Start bosgan bo'lishi kerak.",
      { reply_markup: { keyboard: [[{ text: BTN_CANCEL }]], resize_keyboard: true } });
    return;
  }
  if (isOwner(chat) && (text === BTN_ADMINS || text === '/admins')) { await sendAdmins(chat, state); return; }
  if (text === BTN_ADD || text === '/add') {
    state.awaiting[chat] = 'add';
    await store.save(state);
    await send(chat,
      "Yangi odamning Telegram ID raqamini yoki @username'ini yuboring.\n\n" +
      "⚠️ U odam avval botga kirib Start bosgan bo'lishi kerak — aks holda Telegram unga fayl yuborishga ruxsat bermaydi.\n" +
      "Start bosganida sizga avtomatik so'rov ham keladi.",
      { reply_markup: { keyboard: [[{ text: BTN_CANCEL }]], resize_keyboard: true } });
    return;
  }
  if (text === BTN_LIST || text === '/list') { await sendList(chat, state); return; }
  if (text === BTN_CANCEL) {
    delete state.awaiting[chat];
    await store.save(state);
    await send(chat, 'Bekor qilindi.', { reply_markup: menuFor(chat) });
    return;
  }

  const mode = state.awaiting[chat];
  if (mode === 'add' || (mode === 'admin' && isOwner(chat))) {
    let p = null;
    if (m.forward_from) p = person(m.forward_from);
    else if (/^\d{5,15}$/.test(text)) {
      p = findKnown(state, text);
      if (!p) {
        const c = await tg('getChat', { chat_id: text });
        if (c && c.ok) p = person(c.result);
      }
      if (!p) {
        await send(chat, '❗ ' + text + " ID'li odam hali botga Start bosmagan. Avval u Start bossin, keyin qayta yuboring.");
        return;
      }
    } else if (/^@?[A-Za-z0-9_]{4,32}$/.test(text)) {
      const u = text.replace(/^@/, '').toLowerCase();
      p = [...state.pending, ...state.seen].find((x) => x.username.toLowerCase() === u);
      if (!p) {
        await send(chat, '❗ @' + u + " botga hali Start bosmagan. Avval u botga kirib Start bossin, keyin qayta yuboring.");
        return;
      }
    } else {
      await send(chat, "ID raqam (masalan 123456789) yoki @username yuboring. Bekor qilish: " + BTN_CANCEL);
      return;
    }
    delete state.awaiting[chat];
    if (mode === 'admin') {
      const ok = await appointHelper(state, p, chat);
      if (!ok) await store.save(state);
      await send(chat, ok ? '👮 Admin tayinlandi: ' + label(p) : 'ℹ️ Bu odam allaqachon admin: ' + label(p), { reply_markup: OWNER_MENU });
      return;
    }
    const ok = await addRecipient(state, p, chat);
    if (!ok) await store.save(state);
    await send(chat, ok ? "✅ Qo'shildi: " + label(p) : "ℹ️ Bu odam allaqachon ro'yxatda: " + label(p), { reply_markup: menuFor(chat) });
    return;
  }

  await send(chat, 'Menyudan tanlang.', { reply_markup: menuFor(chat) });
}

async function userMessage(state, m, p) {
  if (isRecipient(state, p.id)) {
    await send(p.id, "✅ Siz ro'yxatdasiz. Yangi yuklangan fayllar sizga keladi.");
    return;
  }
  if (state.pending.some((x) => x.id === p.id)) {
    await store.save(state);
    await send(p.id, "⏳ So'rovingiz yuborilgan. Admin tasdiqlashini kuting.");
    return;
  }
  state.pending.push(Object.assign({}, p, { time: new Date().toISOString() }));
  await store.save(state);
  await send(p.id, "⏳ So'rovingiz adminga yuborildi. Tasdiqlangandan keyin yangi fayllar sizga keladi.");
  for (const a of allAdmins(state)) {
    await send(a, "🆕 Yangi so'rov: " + label(p) + "\nUnga ham fayllar borsinmi?", {
      reply_markup: { inline_keyboard: [[
        { text: "✅ Qo'shish", callback_data: 'add:' + p.id },
        { text: '❌ Rad etish', callback_data: 'rej:' + p.id },
      ]] },
    }).catch(() => {});
  }
}

// ✅ / ❌ under a Minar 2 registration request (api/minar2): the decision goes to the Minar 2 server (api/approve).
const MINAR2_SERVER = () => String(process.env.MINAR2_SERVER_URL || 'https://minar2-server.vercel.app').replace(/\/+$/, '');
async function onMinar2(q, allow, login) {
  const by = person(q.from).name;
  let out = null;
  try {
    const r = await fetch(MINAR2_SERVER() + '/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: process.env.MINAR2_LINK_KEY || '', login, allow, by }) });
    out = await r.json().catch(() => null);
    console.log('minar2 approve', login, allow, r.status, out && (out.ok ? out.status : out.error));
  } catch (e) { console.error('minar2 approve failed', login, e && e.message); }
  const result = !(out && out.ok) ? "❗ Minar 2 serveriga ulanib bo'lmadi, qayta bosing." + (out && out.error ? ' (' + out.error + ')' : '')
    : allow ? '✅ Ruxsat berildi (' + by + ')' : '❌ Rad etildi (' + by + ')';
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: result.slice(0, 190) });
  // A failed call keeps the buttons, so the admin can press again.
  if (q.message && out && out.ok) await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: (q.message.text || ('Minar 2: ' + login)) + '\n\n' + result });
  // the owner is told what an assistant admin decided
  if (out && out.ok && !isOwner(q.from.id)) for (const o of store.admins()) await send(o, 'ℹ️ Minar 2, login ' + login + ': ' + result).catch(() => {});
}

async function onCallback(q) {
  const admin = String(q.from.id);
  const state = await store.load();
  const data = String(q.data || '');
  const [act, id] = data.split(':');
  // assistant admins: approve / reject requests (bot and Minar 2 registrations); removing people and admins stay with the owner
  const allowed = isOwner(admin) || (isHelper(state, admin) && ['add', 'rej', 'm2ok', 'm2no'].includes(act));
  if (!allowed) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: "Ruxsat yo'q" }); return; }
  if (/^m2(ok|no):/.test(data)) { await onMinar2(q, data.startsWith('m2ok:'), data.slice(5)); return; }
  const p = findKnown(state, id) || { id: String(id), username: '', name: String(id) };
  let result;

  if (act === 'add') {
    result = (await addRecipient(state, p, admin)) ? "✅ Qo'shildi: " + label(p) : "ℹ️ Allaqachon ro'yxatda: " + label(p);
  } else if (act === 'rej') {
    state.pending = state.pending.filter((x) => x.id !== p.id);
    await store.save(state);
    result = '❌ Rad etildi: ' + label(p);
  } else if (act === 'del') {
    const before = state.recipients.length;
    state.recipients = state.recipients.filter((r) => r.id !== p.id);
    if (state.recipients.length !== before) {
      await store.save(state);
      await send(p.id, "ℹ️ Siz fayl oluvchilar ro'yxatidan chiqarildingiz.").catch(() => {});
      result = "🗑 O'chirildi: " + label(p);
    } else result = "ℹ️ Ro'yxatda yo'q: " + label(p);
  } else if (act === 'unadm') {
    const before = (state.helpers || []).length;
    state.helpers = (state.helpers || []).filter((h) => h.id !== p.id);
    if (state.helpers.length !== before) {
      await store.save(state);
      await send(p.id, 'ℹ️ Siz endi admin emassiz. Fayllar avvalgidek kelaveradi.', { reply_markup: { remove_keyboard: true } }).catch(() => {});
      result = '🛡 Adminlikdan olindi: ' + label(p) + " (fayl oluvchilar ro'yxatida qoldi)";
    } else result = 'ℹ️ Admin emas: ' + label(p);
  } else return;

  await tg('answerCallbackQuery', { callback_query_id: q.id, text: result.slice(0, 190) });
  if (q.message) await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: result });
}

// Phone check for a new Minar registration (user, 2 Nov 2026; lib/phone-code). The app opens t.me/<bot>?start=verify;
// the bot asks for the contact with Telegram's own «share phone» button and answers with the 6-digit code for that
// number. This path never touches the file-recipient list: no request goes to the admins, nothing is stored.
const BTN_PHONE = '📱 Raqamni ulashish / Поделиться номером';
async function phoneMessage(m) {
  const chat = String(m.chat.id);
  if (m.contact) {
    if (String(m.contact.user_id || '') !== String(m.from.id)) {
      await send(chat, "❗ Faqat o'zingizning raqamingizni pastdagi tugma orqali yuboring.\n❗ Отправьте только свой номер кнопкой ниже.");
      return true;
    }
    const code = phone.codeFor(m.contact.phone_number);
    if (!code) { await send(chat, "❗ Kod yaratib bo'lmadi, birozdan keyin qayta urinib ko'ring.\n❗ Не удалось создать код, попробуйте позже."); return true; }
    const shown = '+' + phone.normalize(m.contact.phone_number);
    await send(chat, '🔐 Minar tasdiqlash kodi / код подтверждения:\n\n' + code + '\n\n' + shown +
      " raqami uchun. Kodni Minar dasturiga yozing, 10 daqiqa amal qiladi. Kodni hech kimga bermang.\n" +
      'Для номера ' + shown + '. Введите код в программе Minar, он действует 10 минут. Никому не сообщайте код.',
      { reply_markup: { remove_keyboard: true } });
    return true;
  }
  if (/^\/start\s+verify\b/.test(m.text || '')) {
    await send(chat, "Minar: telefon raqamingizni tasdiqlash uchun pastdagi «📱 Raqamni ulashish» tugmasini bosing.\n" +
      'Minar: чтобы подтвердить номер телефона, нажмите кнопку «📱 Поделиться номером» ниже.',
      { reply_markup: { keyboard: [[{ text: BTN_PHONE, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    return true;
  }
  return false;
}

async function onMessage(m) {
  if (!m.chat || m.chat.type !== 'private' || !m.from) return;
  if (await phoneMessage(m)) return;
  const state = await store.load();
  const p = person(m.from);
  remember(state, p);
  if (isAdmin(state, p.id)) await adminMessage(state, m);
  else await userMessage(state, m, p);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(200).json({ ok: true, webhook: 'telegram' }); return; }
  if (req.headers['x-telegram-bot-api-secret-token'] !== store.webhookSecret()) { console.warn('telegram webhook: wrong secret'); res.status(401).json({ ok: false }); return; }
  let u = req.body;
  if (typeof u === 'string') { try { u = JSON.parse(u); } catch { u = {}; } }
  if (u && u.callback_query) console.log('telegram callback', String(u.callback_query.data || '').slice(0, 70), 'owner:', isOwner(String(u.callback_query.from && u.callback_query.from.id)));
  try {
    if (u && u.callback_query) await onCallback(u.callback_query);
    else if (u && u.message) await onMessage(u.message);
  } catch (e) {
    console.error('telegram webhook', e);
  }
  // Always 200, otherwise Telegram keeps retrying the same update.
  res.status(200).json({ ok: true });
};
