function getReplyTarget(msg, ctx) {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.documentMessage?.contextInfo
        || msg.message?.stickerMessage?.contextInfo
        || msg.message?.audioMessage?.contextInfo;

    // Aucun message cité → on cite la commande elle-même (objet WAMessage complet).
    if (!contextInfo?.stanzaId) return msg;

    // Message cité → on construit un WAMessage minimal mais VALIDE pour Baileys.
    return {
        key: {
            remoteJid: ctx.from,
            id: contextInfo.stanzaId,
            participant: ctx.isGroup ? contextInfo.participant : undefined,
            fromMe: false
        },
        message: contextInfo.quotedMessage || {}
    };
}

/**
 * Envoi sécurisé : `quoted` n'est ajouté que si on a un WAMessage valide.
 * Cela évite tout crash "Cannot read properties of undefined (reading 'fromMe')".
 */
async function safeSend(sock, jid, content, replyTarget) {
    const opts = replyTarget && replyTarget.key ? { quoted: replyTarget } : {};
    return sock.sendMessage(jid, content, opts);
}

module.exports = {
    name: 'tagall',
    aliases: ['tous', 'everyone', 'all'],
    description: 'Mentionne tous les membres du groupe',

    async execute(sock, msg, botState, ctx) {
        console.log('📢 [TAGALL] Commande reçue | isGroup:', ctx.isGroup, '| from:', ctx.from);

        const replyTarget = getReplyTarget(msg, ctx);

        // 1. Vérification groupe
        if (!ctx.isGroup) {
            await safeSend(
                sock,
                ctx.from,
                { text: '👥 Cette commande est disponible uniquement dans un groupe.' },
                replyTarget
            );
            return;
        }

        const customMessage = (ctx.args || []).join(' ').trim();

        try {
            // 2. Récupération des membres
            const groupMetadata = await sock.groupMetadata(ctx.from);
            const participants = groupMetadata?.participants || [];

            if (participants.length === 0) {
                await safeSend(
                    sock,
                    ctx.from,
                    { text: '📭 Aucun membre trouvé dans ce groupe.' },
                    replyTarget
                );
                return;
            }

            // 3. Construction de la liste des mentions (dédupliquée)
            const mentions = [
                ...new Map(
                    participants
                        .map(p => p.id || p.jid || p.lid)
                        .filter(jid =>
                            jid &&
                            (jid.includes('@s.whatsapp.net')
                                || jid.includes('@lid')
                                || jid.includes('@c.us'))
                        )
                        .map(jid => [jid, jid])
                ).values()
            ];

            if (mentions.length === 0) {
                await safeSend(
                    sock,
                    ctx.from,
                    { text: '⚠️ Aucun membre mentionnable dans ce groupe.' },
                    replyTarget
                );
                return;
            }

            // 4. Construction du message final
            const subject = String(groupMetadata.subject || 'ce groupe').trim();
            const body = customMessage || 'Notification générale';

            let text = `📢 *${body}*\n\n`;
            text += mentions.map(jid => `@${jid.split('@')[0]}`).join('\n');

            // 5. Envoi avec mentions + quoted
            await safeSend(
                sock,
                ctx.from,
                {
                    text: `👥 *${subject}*\n\n${text.trim()}`,
                    mentions
                },
                replyTarget
            );

            console.log(`✅ [TAGALL] ${subject} : ${mentions.length} membres mentionnés`);
        } catch (e) {
            console.error('❌ [TAGALL] Erreur:', e.message);

            // On ne renvoie pas de quoted ici pour éviter tout risque de re-crash.
            try {
                await sock.sendMessage(ctx.from, {
                    text: `⚠️ La mention générale n’a pas pu être envoyée.\n_Raison : ${e.message}_`
                });
            } catch (err) {
                console.error('❌ [TAGALL] Impossible même d’envoyer le message d’erreur:', err.message);
            }
        }
    }
};
