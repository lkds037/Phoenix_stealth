const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { resolveDisplayName } = require('../core/displayNames');
const { start } = require('../core/presenceSimulation');
const { resolveTargetJid } = require('../core/target');

module.exports = {
    name: 'type',
    aliases: ['ecrit'],
    description: 'Simule la frappe',
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

        try {
            await sock.sendPresenceUpdate('available', targetJid);
        } catch (e) { }
        const started = await start(sock, botState, targetJid, 'composing');
        if (!started) {
            await sock.sendMessage(myJid, { text: '⚠️ Impossible de maintenir l’état « écrit » : la connexion WhatsApp n’est pas disponible.' }, { quoted: msg });
            return;
        }

        await sock.sendMessage(myJid, { text: `╭━━━〔 ✍️ GHOST TYPE 〕━━━╮\n┃ ✅ Simulation activée\n┃ 👤 Cible : *${targetDisplay}*\n┃ 🔁 Arrêt : !stop\n╰━━━━━━━━━━━━━━━━━━━━━━╯` });
    }
};
