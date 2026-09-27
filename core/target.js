const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { isNonPersonJid } = require('./contacts');

function resolveTargetJid(arg, ctx, botState) {
    const query = String(arg || '').trim();
    if (!query) return { jid: jidNormalizedUser(ctx.from), name: '' };

    const digits = query.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
        const jid = jidNormalizedUser(`${digits}@s.whatsapp.net`);
        const stored = botState?.contactNames?.[jid];
        return { jid, name: stored || '' };
    }

    const lowered = query.toLowerCase();
    for (const [jid, name] of Object.entries(botState?.contactNames || {})) {
        if (isNonPersonJid(jid) || jid.endsWith('@lid')) continue;
        if (String(name).toLowerCase() === lowered) {
            return { jid: jidNormalizedUser(jid), name: String(name) };
        }
    }
    for (const [jid, name] of Object.entries(botState?.contactNames || {})) {
        if (isNonPersonJid(jid) || jid.endsWith('@lid')) continue;
        if (String(name).toLowerCase().includes(lowered)) {
            return { jid: jidNormalizedUser(jid), name: String(name) };
        }
    }
    return null;
}

module.exports = { resolveTargetJid };
