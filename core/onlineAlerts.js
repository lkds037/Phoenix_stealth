const fs = require('fs');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { isNonPersonJid, getAllContacts } = require('./contacts');
const { resolveDisplayName } = require('./displayNames');
const { resolveLidToPhone } = require('./lidResolver');

function ownerJid(botState) {
    return `${String(botState.PHONE_NUMBER || '').replace(/\D/g, '')}@s.whatsapp.net`;
}

function base(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function sameNumber(left, right) {
    const a = base(left).replace(/^0+/, '');
    const b = base(right).replace(/^0+/, '');
    if (!a || !b) return false;
    return a === b || (a.length >= 8 && b.length >= 8 && (a.endsWith(b) || b.endsWith(a)));
}

function load(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
}

function persist(botState) {
    if (!botState.ONLINE_ALERTS_JSON) return;
    try { fs.writeFileSync(botState.ONLINE_ALERTS_JSON, JSON.stringify(botState.onlineAlerts, null, 2)); } catch (_) { }
}

function findTarget(query, botState) {
    const text = String(query || '').trim().toLowerCase();
    if (!text) return null;
    const digits = text.replace(/\D/g, '');
    for (const [jid, name] of Object.entries(botState.contactNames || {})) {
        if (isNonPersonJid(jid) || jid.endsWith('@lid')) continue;
        if ((digits.length >= 7 && sameNumber(jid, digits)) || String(name).toLowerCase() === text) {
            return { jid: jidNormalizedUser(jid), name: String(name) };
        }
    }
    for (const [jid, name] of Object.entries(botState.contactNames || {})) {
        if (isNonPersonJid(jid) || jid.endsWith('@lid')) continue;
        if (String(name).toLowerCase().includes(text)) return { jid: jidNormalizedUser(jid), name: String(name) };
    }
    for (const contact of getAllContacts()) {
        const contactName = String(contact.name).toLowerCase();
        if (contactName === text || contactName.includes(text) || (digits.length >= 7 && sameNumber(contact.jid, digits))) {
            return { jid: jidNormalizedUser(contact.jid), name: String(contact.name) };
        }
    }
    if (digits.length >= 7) {
        const jid = `${digits}@s.whatsapp.net`;
        return { jid, name: 'Contact WhatsApp' };
    }
    return null;
}

async function add(sock, botState, query, message) {
    const target = findTarget(query, botState);
    if (!target) return { ok: false, error: `Contact introuvable : ${query}` };
    const existing = botState.onlineAlerts[target.jid] || {};
    botState.onlineAlerts[target.jid] = {
        jid: target.jid,
        name: target.name,
        message: String(message || existing.message || '🔔 {name} est maintenant en ligne.'),
        enabled: true,
        lastState: 'offline',
        lastNotifiedAt: existing.lastNotifiedAt || 0
    };
    persist(botState);
    return { ok: true, alert: botState.onlineAlerts[target.jid] };
}

function remove(botState, query) {
    const target = findTarget(query, botState);
    if (!target || !botState.onlineAlerts[target.jid]) return false;
    delete botState.onlineAlerts[target.jid];
    persist(botState);
    return true;
}

async function notify(sock, botState, jid, status, profileName = '') {
    if (!['available', 'composing', 'recording'].includes(status)) return;
    const targetPhone = base(jid).length >= 7
        ? base(jid)
        : await resolveLidToPhone(sock, jid);
    for (const alert of Object.values(botState.onlineAlerts || {})) {
        if (!alert.enabled) continue;
        const alertPhone = base(alert.jid).length >= 7
            ? base(alert.jid)
            : await resolveLidToPhone(sock, alert.jid);
        if (!sameNumber(alertPhone, targetPhone)) continue;
        if (alert.lastState === 'online' && Date.now() - Number(alert.lastNotifiedAt || 0) < 300000) continue;
        const display = await resolveDisplayName(sock, alert.jid, botState, profileName || alert.name);
        alert.name = display.name;
        alert.lastState = 'online';
        alert.lastNotifiedAt = Date.now();
        persist(botState);
        const text = String(alert.message || '🔔 {name} est maintenant en ligne.')
            .replaceAll('{name}', display.name);
        await sock.sendMessage(ownerJid(botState), { text: `╭━━━〔 🔔 ALERTE ONLINE 〕━━━╮\n┃ 👤 ${text}\n╰━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
}

async function markOffline(sock, botState, jid) {
    const targetPhone = base(jid).length >= 7
        ? base(jid)
        : await resolveLidToPhone(sock, jid);
    for (const alert of Object.values(botState.onlineAlerts || {})) {
        const alertPhone = base(alert.jid).length >= 7
            ? base(alert.jid)
            : await resolveLidToPhone(sock, alert.jid);
        if (sameNumber(alertPhone, targetPhone)) alert.lastState = 'offline';
    }
}

module.exports = { load, persist, add, remove, notify, markOffline, findTarget };
