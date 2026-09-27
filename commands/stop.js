const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { resolveDisplayName } = require('../core/displayNames');
const { stop } = require('../core/presenceSimulation');
const { resolveTargetJid } = require('../core/target');

module.exports = {
    name: 'stop',
    aliases: ['arrete'],
    description: 'Arrête les simulations',
    async execute(sock, msg, botState, ctx) {
        const myJid = `${String(botState.PHONE_NUMBER).replace(/\D/g, '')}@s.whatsapp.net`;
        const arg = ctx.args.join(' ').trim();
        let targetJid = ctx.from;
        let targetDisplay = "Contact WhatsApp";

        const target = resolveTargetJid(arg, ctx, botState);
        if (!target) {
            await sock.sendMessage(myJid, { text: `⚠️ Contact introuvable : *${arg}*.` }, { quoted: msg });
            return;
        }
        targetJid = target.jid || jidNormalizedUser(targetJid);

        if (targetJid.endsWith('@g.us')) {
            try { targetDisplay = (await sock.groupMetadata(targetJid)).subject; } catch { targetDisplay = "Ce Groupe"; }
        } else targetDisplay = (await resolveDisplayName(sock, targetJid, botState, ctx.from === targetJid ? msg.pushName : '')).name;

        stop(botState, targetJid);
        try { await sock.sendPresenceUpdate('paused', targetJid); } catch (e) { }

        await sock.sendMessage(myJid, { text: `╭━━━〔 🛑 PHOENIX STOP 〕━━━╮\n┃ ✅ Simulations arrêtées\n┃ 👤 Cible : *${targetDisplay}*\n┃ 🌿 La présence est revenue à la normale.\n╰━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
};
