const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const { handleMessages, handleReceipts } = require('./core/messages');
const { handleDeliveryReceipt, handleMessagesUpdate, handleRawReceipt } = require('./core/silentTracker');
const { incrementMessagesSent } = require('./core/stats');
const { setContactName, isNonPersonJid, replaceContactBook } = require('./core/contacts');
const { rememberContact } = require('./core/displayNames');
const { registerMapping } = require('./core/lidResolver');
const onlineAlerts = require('./core/onlineAlerts');
const presenceSimulation = require('./core/presenceSimulation');

// ==========================================
// ANTI-CRASH
// ==========================================
process.on('uncaughtException', (err) => {
    console.error(`🔥 [ANTI-CRASH] uncaughtException:`, err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error(`🔥 [ANTI-CRASH] unhandledRejection:`, reason);
});

// ==========================================
// FILTRE DE LOGS
// ==========================================
const FILTER_PATTERNS = [
    'Closing session:', 'Closing open session', 'currentRatchet',
    'SessionEntry', '_chains:', 'ephemeralKeyPair:',
    'lastRemoteEphemeralKey:', 'previousCounter:', 'rootKey:',
    'indexInfo:', 'baseKey:', 'baseKeyType:', 'remoteIdentityKey:',
    'pendingPreKey:', 'registrationId:', 'chainKey:', 'chainType:',
    'messageKeys:', 'signedKeyId:', 'preKeyId:', 'pubKey:', 'privKey:'
];

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
const QUIET_TERMINAL = process.env.PHOENIX_VERBOSE !== 'true';

function shouldFilter(chunk) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    return FILTER_PATTERNS.some(p => str.includes(p));
}

process.stdout.write = (chunk, ...args) => {
    if (shouldFilter(chunk)) return true;
    return originalStdoutWrite(chunk, ...args);
};

process.stderr.write = (chunk, ...args) => {
    if (shouldFilter(chunk)) return true;
    return originalStderrWrite(chunk, ...args);
};

if (QUIET_TERMINAL) {
    console.log = () => {};
    console.warn = () => {};
}

function terminalNotice(text) {
    originalStdoutWrite(`${text}\n`);
}

const ANSI = process.stdout.isTTY ? {
    reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m'
} : { reset: '', cyan: '', green: '', yellow: '', red: '', dim: '', bold: '' };

function terminalLog(icon, label, message, color = ANSI.cyan) {
    originalStdoutWrite(`${color}${icon} ${ANSI.bold}${label.padEnd(12)}${ANSI.reset} ${message}\n`);
}

function terminalBanner() {
    terminalNotice(`\n${ANSI.cyan}╭──────────────────────────────────────────────╮${ANSI.reset}`);
    terminalNotice(`${ANSI.cyan}│${ANSI.reset} ${ANSI.bold}🦅 PHOENIX STEALTH${ANSI.reset}  ${ANSI.dim}· control center${ANSI.reset}       ${ANSI.cyan}│${ANSI.reset}`);
    terminalNotice(`${ANSI.cyan}╰──────────────────────────────────────────────╯${ANSI.reset}`);
}

// ==========================================
// SERVEUR
// ==========================================
const app = express();
app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phoenix Stealth · Centre de contrôle</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #eef2ff; background: radial-gradient(circle at 15% 10%, #263b69 0, #10172a 38%, #080b14 100%); }
    main { width: min(92vw, 680px); padding: 42px; border: 1px solid rgba(148,163,184,.24); border-radius: 28px; background: rgba(15,23,42,.76); box-shadow: 0 24px 80px rgba(0,0,0,.35); backdrop-filter: blur(14px); }
    .mark { width: 58px; height: 58px; display: grid; place-items: center; border-radius: 18px; background: linear-gradient(135deg, #7c3aed, #2563eb); font-size: 28px; box-shadow: 0 10px 28px rgba(59,130,246,.28); }
    h1 { margin: 26px 0 10px; font-size: clamp(2rem, 6vw, 3.3rem); letter-spacing: -.05em; }
    p { color: #b8c2d8; line-height: 1.65; }
    .status { display: inline-flex; gap: 10px; align-items: center; margin-top: 16px; padding: 10px 14px; border-radius: 999px; color: #bbf7d0; background: rgba(34,197,94,.12); border: 1px solid rgba(74,222,128,.24); font-weight: 650; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 16px #4ade80; }
    footer { margin-top: 34px; color: #7f8ba5; font-size: .9rem; }
  </style>
</head>
<body><main><div class="mark" aria-hidden="true">🦅</div><h1>Phoenix Stealth</h1><p>Centre de contrôle de votre assistant WhatsApp. La connexion est active et les services sont prêts à répondre.</p><div class="status"><span class="dot"></span> Noyau opérationnel</div><footer>Version ${require('./package.json').version} · Interface de supervision</footer></main></body>
</html>`);
});
app.get('/healthz', (req, res) => res.json({ status: 'ok', service: 'phoenix-stealth', uptimeSeconds: Math.floor(process.uptime()) }));
app.listen(process.env.PORT || 3000, () => terminalLog('◆', 'WEB', `interface active sur le port ${process.env.PORT || 3000}`, ANSI.green));

// ==========================================
// ÉTAT GLOBAL
// ==========================================
const LOCAL_DIR = path.join(__dirname, 'Phoenix_Media');
const NAMES_FILE = path.join(LOCAL_DIR, 'contacts_names.json');
const STATUS_JSON = path.join(LOCAL_DIR, 'status_cache.json');
const ONLINE_ALERTS_JSON = path.join(LOCAL_DIR, 'online_alerts.json');
const STATUS_DIR = path.join(LOCAL_DIR, 'statuses');

if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
if (!fs.existsSync(STATUS_DIR)) fs.mkdirSync(STATUS_DIR, { recursive: true });

let cleanContacts = {};
if (fs.existsSync(NAMES_FILE)) {
    try {
        const rawContacts = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'));
        for (const [key, name] of Object.entries(rawContacts)) {
            const jid = jidNormalizedUser(key);
            if (!isNonPersonJid(jid) && !jid.endsWith('@lid')) cleanContacts[jid] = name;
        }
        console.log(`📇 ${Object.keys(cleanContacts).length} contact(s) chargé(s)`);
    } catch (e) { }
}

const botState = {
    PHONE_NUMBER: String(process.env.PHONE_NUMBER || '').replace(/\D/g, ''),
    START_TIME: Date.now(),
    LOCAL_DIR: LOCAL_DIR,
    NAMES_FILE: NAMES_FILE,
    STATUS_JSON: STATUS_JSON,
    ONLINE_ALERTS_JSON,
    DIRS: { statuts: STATUS_DIR },
    cacheMessages: new Map(),
    contactNames: cleanContacts,
    // Noms de profil temporaires : utilisés seulement quand aucun nom du
    // carnet WhatsApp n’existe, jamais à la place d’un nom enregistré.
    profileNames: {},
    scheduleSaveContacts,
    activeIntervals: {},
    statusCache: normalizeStatusCache(loadJsonFile(STATUS_JSON, {})),
    onlineAlerts: onlineAlerts.load(ONLINE_ALERTS_JSON),
    isSavingContacts: false,
    isSavingStatus: false,
    currentSock: null,
            onlineUsers: new Map(),
            presenceModes: {},
            subscribedJids: new Set(),
    loginMode: null
};

global.botState = botState;
if (!globalThis.lidPhoneCache) globalThis.lidPhoneCache = new Map();

// ==========================================
// FLAGS PERSISTANTS
// ==========================================
let PROCESS_PAIRING_REQUESTED = false;
let PROCESS_HAS_CONNECTED = false;

function loadJsonFile(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
        console.warn(`⚠️ Impossible de lire ${file}: ${e.message}`);
        return fallback;
    }
}

function normalizeStatusCache(cache) {
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return {};
    return Object.fromEntries(
        Object.entries(cache)
            .filter(([, statuses]) => Array.isArray(statuses))
            .map(([jid, statuses]) => [jid, statuses.filter(Boolean)])
    );
}

function saveContactsNow() {
    try {
        fs.writeFileSync(botState.NAMES_FILE, JSON.stringify(botState.contactNames, null, 2));
    } catch (e) { }
}

let saveContactsTimer = null;
function scheduleSaveContacts() {
    if (saveContactsTimer) clearTimeout(saveContactsTimer);
    saveContactsTimer = setTimeout(saveContactsNow, 3000);
}

function getWhatsAppContactName(contact) {
    const savedName = String(contact?.name || '').trim();
    if (savedName && savedName !== '.') return savedName;
    return '';
}

function syncWhatsAppContacts(contacts, sock) {
    let changed = 0;
    for (const contact of contacts || []) {
        if (!contact?.id) continue;
        const jid = jidNormalizedUser(contact.id);
        if (isNonPersonJid(jid)) continue;
        const name = rememberContact(contact, botState) || getWhatsAppContactName(contact);
        // Les LID servent à résoudre les appareils, mais ne doivent jamais
        // apparaître comme des contacts séparés dans le carnet.
        if (isNonPersonJid(jid) || jid.endsWith('@lid')) continue;
        if (name && !jid.endsWith('@g.us')) {
            // Seul `name` représente un nom réellement enregistré dans le carnet.
            if (name && botState.contactNames[jid] !== name) {
                botState.contactNames[jid] = name;
                setContactName(jid, name);
                changed++;
            }
        }
        if (sock && !jid.endsWith('@g.us')) enqueueSubscribe(sock, jid);
    }
    if (changed > 0) scheduleSaveContacts();
    return changed;
}

// ==========================================
// QUEUE DE SUBSCRIPTION
// ==========================================
const subscriptionQueue = [];
let isProcessingQueue = false;
let lastSubscribeTime = 0;
const MIN_SUBSCRIBE_INTERVAL = 200;

function enqueueSubscribe(sock, jid) {
    if (!jid) return;
    if (botState.subscribedJids.has(jid)) return;
    if (subscriptionQueue.includes(jid)) return;
    subscriptionQueue.push(jid);
    botState.subscribedJids.add(jid);
    if (!isProcessingQueue) processSubscriptionQueue(sock);
}

async function processSubscriptionQueue(sock) {
    isProcessingQueue = true;
    while (subscriptionQueue.length > 0) {
        const jid = subscriptionQueue.shift();
        const now = Date.now();
        const wait = MIN_SUBSCRIBE_INTERVAL - (now - lastSubscribeTime);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        try {
            await sock.presenceSubscribe(jid);
            lastSubscribeTime = Date.now();
        } catch (e) { }
    }
    isProcessingQueue = false;
}

// ==========================================
// NETTOYAGE PÉRIODIQUE
// ==========================================
setInterval(() => {
    const now = Date.now();
    for (const jid in botState.statusCache) {
        if (!Array.isArray(botState.statusCache[jid])) {
            delete botState.statusCache[jid];
            continue;
        }
        // Les statuts sont horodatés par Date.now(), donc l'expiration est en ms.
        const keptStatuses = [];
        for (const s of botState.statusCache[jid]) {
            const rawTimestamp = Number(s.timestamp || 0);
            const timestampMs = rawTimestamp > 0 && rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp;
            if (timestampMs > 0 && (now - timestampMs) < 86400 * 1000) {
                keptStatuses.push(s);
            } else if (s.localPath) {
                try { if (fs.existsSync(s.localPath)) fs.unlinkSync(s.localPath); } catch (_) { }
            }
        }
        botState.statusCache[jid] = keptStatuses;
        if (botState.statusCache[jid].length === 0) delete botState.statusCache[jid];
    }
    if (botState.cacheMessages.size > 3000) {
        const firstKey = botState.cacheMessages.keys().next().value;
        botState.cacheMessages.delete(firstKey);
    }
    const nowMs = Date.now();
    for (const [jid, ts] of botState.onlineUsers.entries()) {
        if (nowMs - ts > 120000) botState.onlineUsers.delete(jid);
    }
}, 3600000);

// ==========================================
// CHOIX MODE
// ==========================================
function askLoginMode() {
    const AUTH_DIR = path.resolve(process.env.AUTH_DIR || path.join(__dirname, 'auth_info'));
    return fs.existsSync(path.join(AUTH_DIR, 'creds.json')) ? 'existing' : 'pairing';
}

// ==========================================
// MOTEUR
// ==========================================
let reconnectTimer = null;
let pairingTimer = null;
let attemptCount = 0;
const MAX_ATTEMPTS = 3;

async function startStealthBot() {
    try {
        attemptCount++;
        terminalLog('◌', 'SYSTEM', `initialisation du noyau · tentative #${attemptCount}`);

        const AUTH_DIR = path.resolve(process.env.AUTH_DIR || path.join(__dirname, 'auth_info'));
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            markOnlineOnConnect: false,
            syncFullHistory: true,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            getMessage: async (key) => botState.cacheMessages.get(key.id)?.message || undefined
        });

        const sendMessage = sock.sendMessage.bind(sock);
        sock.sendMessage = async (...args) => {
            const result = await sendMessage(...args);
            incrementMessagesSent();
            return result;
        };

        botState.currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // ==========================================
            // PAIRING CODE
            // ==========================================
            if (
                qr &&
                botState.loginMode === 'pairing' &&
                !state.creds.registered &&
                !PROCESS_PAIRING_REQUESTED &&
                !PROCESS_HAS_CONNECTED
            ) {
                PROCESS_PAIRING_REQUESTED = true;

                terminalLog('⌁', 'PAIRING', 'connexion prête · code dans 5 secondes', ANSI.yellow);
                pairingTimer = setTimeout(async () => {
                    pairingTimer = null;
                    try {
                        const phone = String(botState.PHONE_NUMBER).replace(/\D/g, '');
                        if (!/^\d{7,15}$/.test(phone)) {
                            throw new Error('PHONE_NUMBER doit contenir 7 à 15 chiffres avec indicatif pays');
                        }
                        const code = await sock.requestPairingCode(phone);

                        terminalNotice(`🔢 CODE DE JUMELAGE : ${code?.match(/.{1,4}/g)?.join('-') || 'indisponible'}\nWhatsApp → Appareils connectés → Associer un appareil → Avec un numéro de téléphone`);
                    } catch (err) {
                        terminalLog('✖', 'PAIRING', err.message, ANSI.red);
                        PROCESS_PAIRING_REQUESTED = false;
                    }
                }, 5000);
            }

            // ==========================================
            // FERMETURE
            // ==========================================
            if (connection === 'close') {
                if (pairingTimer) {
                    clearTimeout(pairingTimer);
                    pairingTimer = null;
                }
                for (const jid in botState.activeIntervals) clearInterval(botState.activeIntervals[jid]);
                botState.activeIntervals = {};
                if (botState.currentSock === sock) botState.currentSock = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isRegistered = state.creds.registered === true;
                const pairingFailedBeforeRegistration = !isRegistered && botState.loginMode === 'pairing';
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut || pairingFailedBeforeRegistration;
                terminalLog('↻', 'WHATSAPP', `connexion fermée · code ${statusCode || 'inconnu'} · reconnexion ${shouldReconnect ? 'prévue' : 'non'}`, ANSI.yellow);
                if (!isRegistered) PROCESS_PAIRING_REQUESTED = false;


                // ==========================================
                // NETTOYAGE UNIQUEMENT sur 401 / 408
                // ==========================================
                if ((statusCode === 401 || statusCode === 408) && isRegistered) {
                    try {
                        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) { }
                    PROCESS_PAIRING_REQUESTED = false;
                    PROCESS_HAS_CONNECTED = false;
                    botState.loginMode = null;
                }

                // ==========================================
                // DELAY
                // ==========================================
                let delay = 3000;
                if (statusCode === 440) delay = 15000;
                if (statusCode === 405 && attemptCount >= MAX_ATTEMPTS) {
                    delay = 30000;
                    attemptCount = 0;
                }
                if (statusCode === 503) delay = 5000;
                if (statusCode === 428 && !isRegistered) {
                    delay = 3000;
                }

                if (shouldReconnect && !reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        if (!botState.loginMode) {
                            askLoginMode().then((mode) => {
                                botState.loginMode = mode;
                                startStealthBot();
                            });
                        } else {
                            startStealthBot();
                        }
                    }, delay);
                }
            } else if (connection === 'open') {
                PROCESS_HAS_CONNECTED = true;
                PROCESS_PAIRING_REQUESTED = true;
                attemptCount = 0;
                terminalLog('●', 'WHATSAPP', 'connexion établie · Phoenix est prêt', ANSI.green);
                const connectedId = sock.user?.id || sock.user?.jid || '';
                const connectedNumber = String(connectedId).split('@')[0].split(':')[0].replace(/\D/g, '');
                if (/^\d{7,15}$/.test(connectedNumber)) {
                    botState.PHONE_NUMBER = connectedNumber;
                }
                try { await sock.sendPresenceUpdate('unavailable'); } catch (e) { }
                try { await presenceSimulation.resumeAll(sock, botState); } catch (e) {
                    terminalLog('⚠', 'PRESENCE', `reprise impossible · ${e.message}`, ANSI.yellow);
                }
            }
        });

        sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            try {
                const directChatJids = new Set(
                    (chats || [])
                        .map((chat) => jidNormalizedUser(chat?.id || ''))
                        .filter((jid) => jid.endsWith('@s.whatsapp.net'))
                );
                if (isLatest && Array.isArray(contacts) && contacts.length > 0) {
                    const rebuilt = replaceContactBook(contacts, directChatJids);
                    if (rebuilt) {
                        botState.contactNames = rebuilt;
                        terminalLog('✓', 'HISTORY', `carnet reconstruit · ${Object.keys(rebuilt).length} nom(s) enregistré(s)`, ANSI.green);
                    }
                    return;
                }
                const scopedContacts = directChatJids.size > 0
                    ? (contacts || []).filter((contact) => [contact?.id, contact?.phoneNumber]
                        .filter(Boolean)
                        .map((value) => jidNormalizedUser(value))
                        .some((jid) => directChatJids.has(jid)))
                    : contacts;
                const added = syncWhatsAppContacts(scopedContacts, sock);
                if (added > 0) terminalLog('＋', 'HISTORY', `+${added} contact(s) · total ${Object.keys(botState.contactNames).length}`);
                if (isLatest) terminalLog('✓', 'HISTORY', 'synchronisation complète', ANSI.green);
            } catch (e) { }
        });

        sock.ev.on('lid-mapping.update', (map) => {
            try {
                let newOnes = 0;
                for (const [lid, pn] of Object.entries(map || {})) {
                    const lidNum = String(lid).split('@')[0].split(':')[0];
                    const phone = String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
                    if (lidNum && phone && !globalThis.lidPhoneCache.has(lidNum)) {
                        registerMapping(lidNum, phone);
                        newOnes++;
                    }
                }
                if (newOnes > 0) terminalLog('＋', 'CONTACTS', `+${newOnes} correspondance(s) LID`);
            } catch (e) { }
        });

        sock.ev.on('contacts.upsert', async (contacts) => {
            const newNames = syncWhatsAppContacts(contacts, sock);
            if (newNames > 0) {
                terminalLog('＋', 'CONTACTS', `${newNames} nom(s) synchronisé(s)`);
            }
        });

        sock.ev.on('contacts.update', (contacts) => {
            const updated = syncWhatsAppContacts(contacts, sock);
            if (updated > 0) terminalLog('↻', 'CONTACTS', `${updated} nom(s) synchronisé(s)`);
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            for (const msg of m.messages) {
                const jid = msg.key?.remoteJid;

                if (jid && !jid.endsWith('@g.us') && jid !== 'status@broadcast') {
                    enqueueSubscribe(sock, jid);
                }
            }
        });

        sock.ev.on('presence.update', async ({ id, presences }) => {
            for (const jid in (presences || {})) {
                const status = presences[jid].lastKnownPresence;
                if (status === 'available' || status === 'composing' || status === 'recording') {
                    const wasOffline = !botState.onlineUsers.has(jid);
                    botState.onlineUsers.set(jid, Date.now());
                    if (wasOffline) {
                        const display = await require('./core/displayNames').resolveDisplayName(sock, jid, botState);
                        terminalLog('●', 'PRESENCE', `${display.name} est disponible`, ANSI.green);
                    }
                    try {
                        const profileName = botState.profileNames?.[jidNormalizedUser(jid)] || '';
                        await onlineAlerts.notify(sock, botState, jid, status, profileName);
                    } catch (e) { console.error('⚠️ [ALERTE ONLINE]', e.message); }
                } else if (status === 'unavailable') {
                    botState.onlineUsers.delete(jid);
                    await onlineAlerts.markOffline(sock, botState, jid);
                }
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (m.type !== 'notify') return;
                await handleMessages(sock, m, botState);
            } catch (e) {
                console.error('⚠️ [MESSAGES] Erreur:', e.message);
            }
        });

        // Selon la version de WhatsApp/Baileys, une révocation peut arriver
        // comme messages.upsert ou comme messages.update.
        sock.ev.on('messages.update', async (updates) => {
            try { handleMessagesUpdate(updates); } catch (e) { }
            for (const item of updates || []) {
                const protocol = item?.update?.message?.protocolMessage;
                if (!protocol || (protocol.type !== 0 && protocol.type !== 'REVOKE')) continue;
                console.log(`🗑️ [ANTI-DELETE] Révocation reçue via messages.update : ${protocol.key?.id || '?'}`);
                try {
                    await handleMessages(sock, {
                        type: 'notify',
                        messages: [{
                            key: item.key,
                            message: item.update.message,
                            messageTimestamp: item.update.messageTimestamp
                        }]
                    }, botState);
                } catch (e) {
                    console.error('⚠️ [ANTI-DELETE] Erreur messages.update:', e.message);
                }
            }
        });

        sock.ev.on('message-receipt.update', (events) => {
            try {
                handleDeliveryReceipt(events);
                if (handleReceipts) handleReceipts(events, botState);
            } catch (e) { }
        });

        // Certaines versions transmettent les reçus "inactive" uniquement
        // sur le flux brut du WebSocket, que Baileys ne remonte pas toujours.
        if (sock.ws?.on) {
            sock.ws.on('CB:receipt', (node) => {
                try { handleRawReceipt(node); } catch (e) { }
            });
        }

    } catch (err) {
        terminalLog('✖', 'SYSTEM', `échec de démarrage : ${err.message}`, ANSI.red);
        if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; startStealthBot(); }, 5000);
    }
}

async function main() {
    terminalBanner();
    terminalLog('ℹ', 'SYSTEM', `Node ${process.version} · mode ${QUIET_TERMINAL ? 'discret' : 'verbose'}`, ANSI.dim);
    if (!/^\d{7,15}$/.test(botState.PHONE_NUMBER)) {
        terminalNotice('⚠️ Configure PHONE_NUMBER dans l’environnement avant le premier démarrage.');
        process.exit(1);
    }
    botState.loginMode = askLoginMode();
    startStealthBot().catch((err) => console.error('🔥 Erreur fatale:', err));
}

main().catch((err) => {
    console.error('🔥 Démarrage impossible:', err);
    process.exitCode = 1;
});
