const fs = require('fs');
const path = require('path');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

const CONTACTS_FILE = path.join(__dirname, '..', 'Phoenix_Media', 'contacts_names.json');

let contacts = {};
let saveTimer = null;

function isPhoneLikeName(value) {
    const text = String(value || '').trim();
    const digits = (text.match(/\d/g) || []).length;
    const letters = (text.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    return digits >= 4 && letters === 0 && /^[+\d\s().∙•·–—-]+$/.test(text);
}

function isValidContactName(value) {
    const text = String(value || '').trim();
    return text.length >= 2 && text !== '.' && !/^\d+$/.test(text) && !isPhoneLikeName(text);
}

function loadContacts() {
    try {
        if (!fs.existsSync(path.dirname(CONTACTS_FILE))) fs.mkdirSync(path.dirname(CONTACTS_FILE), { recursive: true });
        if (!fs.existsSync(CONTACTS_FILE)) return;
        const raw = fs.readFileSync(CONTACTS_FILE, 'utf-8');
        contacts = JSON.parse(raw);
        let cleaned = 0;
        for (const [jid, name] of Object.entries(contacts)) {
            if (!isValidContactName(name) || jid.endsWith('@lid') || isNonPersonJid(jid)) {
                delete contacts[jid];
                cleaned++;
            }
        }
        if (cleaned > 0) fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
        if (process.env.PHOENIX_VERBOSE === 'true') console.log(`📇 Contacts chargés : ${Object.keys(contacts).length}`);
    } catch (e) {
        console.error('⚠️ Erreur chargement contacts:', e.message);
        contacts = {};
    }
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
            saveTimer = null;
        } catch (e) { console.error('⚠️ Erreur sauvegarde contacts:', e.message); }
    }, 2000);
    saveTimer.unref?.();
}

function extractNumber(jid) { return jid ? String(jid).split('@')[0].split(':')[0] : ''; }
function isLid(jid) { return Boolean(jid && jid.endsWith('@lid')); }
function isNonPersonJid(jid) {
    const value = String(jid || '');
    return value.endsWith('@g.us') || value.endsWith('@newsletter') || value.endsWith('@broadcast');
}
function isRealNumber(num) { return Boolean(num && /^\d{7,15}$/.test(num) && !num.startsWith('0')); }

function getContactName(jid) {
    if (!jid) return 'Inconnu';
    const num = extractNumber(jid);
    if (isNonPersonJid(jid)) return contacts[jid] || 'Conversation WhatsApp';
    return contacts[jid] || contacts[`${num}@s.whatsapp.net`] || 'Contact WhatsApp';
}

function setContactName(jid, name) {
    if (!jid || !isValidContactName(name) || isLid(jid) || isNonPersonJid(jid)) return;
    contacts[jid] = String(name).trim();
    scheduleSave();
}

function captureContact(jid, pushName) {
    if (!jid || !pushName || isNonPersonJid(jid) || isLid(jid)) return;
    const num = extractNumber(jid);
    if (!isRealNumber(num) || !isValidContactName(pushName) || contacts[jid]) return;
    contacts[jid] = String(pushName).trim();
    scheduleSave();
}

function captureGroup(jid, subject) {
    return false;
}

function canonicalJid(jid) {
    if (jid.endsWith('@g.us')) return jid;
    const num = extractNumber(jid);
    return /^\d{7,15}$/.test(num) ? `${num}@s.whatsapp.net` : jid;
}

function getAllContacts() {
    const unique = new Map();
    for (const [jid, name] of Object.entries(contacts)) {
        if (isLid(jid) || isNonPersonJid(jid) || !isValidContactName(name)) continue;
        const key = canonicalJid(jid);
        if (!unique.has(key)) unique.set(key, { jid: key, name: String(name).trim() });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

function deleteContactByName(name) {
    const search = String(name).toLowerCase();
    const found = [];
    for (const [jid, n] of Object.entries(contacts)) {
        if (String(n).toLowerCase().includes(search)) {
            found.push({ jid, name: n });
            delete contacts[jid];
        }
    }
    if (found.length > 0) scheduleSave();
    return found;
}

function replaceContactBook(contactRecords, directChatJids = null) {
    const next = {};
    const allowed = directChatJids instanceof Set
        ? new Set([...directChatJids].map((jid) => canonicalJid(jid)))
        : null;
    for (const contact of contactRecords || []) {
        const rawJid = contact?.id;
        const name = String(contact?.name || '').trim();
        if (!rawJid || !name || !isValidContactName(name)) continue;
        const jid = jidNormalizedUser(rawJid);
        if (isLid(jid) || isNonPersonJid(jid)) continue;
        const canonical = canonicalJid(jid);
        if (allowed && allowed.size > 0 && !allowed.has(canonical)) continue;
        next[canonical] = name;
    }
    if (!Object.keys(next).length) return null;
    contacts = next;
    try {
        fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
    } catch (e) { }
    return { ...contacts };
}

loadContacts();

module.exports = {
    loadContacts, getContactName, setContactName, captureContact, captureGroup,
    getAllContacts, deleteContactByName, replaceContactBook, extractNumber, isLid, isRealNumber,
    isPhoneLikeName, isValidContactName, isNonPersonJid, contacts: () => contacts
};
