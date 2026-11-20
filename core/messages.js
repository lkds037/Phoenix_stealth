const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { handleCommand, commands } = require('./commands');
const { incrementMessagesReceived, incrementCommand } = require('./stats');
const { resolveDisplayName } = require('./displayNames');

const PREFIX = '!';

function unwrapMessageInPlace(msg) {
    if (!msg || !msg.message) return msg;
    let inner = msg.message;
    let isVO = false;
    let changed = true;

    while (changed) {
        changed = false;
        if (inner.ephemeralMessage?.message) { inner = inner.ephemeralMessage.message; changed = true; }
        if (inner.documentWithCaptionMessage?.message) { inner = inner.documentWithCaptionMessage.message; changed = true; }
        if (inner.viewOnceMessage?.message) { inner = inner.viewOnceMessage.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV2?.message) { inner = inner.viewOnceMessageV2.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV2Extension?.message) { inner = inner.viewOnceMessageV2Extension.message; isVO = true; changed = true; }
        if (inner.viewOnceMessageV3?.message) { inner = inner.viewOnceMessageV3.message; isVO = true; changed = true; }
        if (inner.ptvMessage) { inner = { videoMessage: inner.ptvMessage }; isVO = true; changed = true; }
    }

    if (inner.imageMessage?.viewOnce || inner.videoMessage?.viewOnce || inner.audioMessage?.viewOnce) isVO = true;

    for (const key in inner) {
        if (inner[key] && typeof inner[key] === 'object' && 'viewOnce' in inner[key]) {
            inner[key].viewOnce = false;
        }
    }

    msg.message = inner;
    msg.wasViewOnce = isVO;
    return msg;
}

async function getChatName(sock, chatId, botState) {
    if (!chatId) return 'Privé';
    if (chatId.endsWith('@g.us')) {
        const normalized = jidNormalizedUser(chatId);
        botState.groupNames ||= {};
        if (botState.groupNames[normalized]) return botState.groupNames[normalized];
        try {
            const metadata = await sock.groupMetadata(chatId);
            const subject = String(metadata?.subject || '').trim();
            if (subject) {
                botState.groupNames[normalized] = subject;
                return subject;
            }
        } catch (_) { }
        return botState.contactNames[normalized] || botState.contactNames[chatId] || 'Groupe';
    }
    return 'Privé';
}

function isQuotedViewOnce(quotedMsg) {
    if (!quotedMsg) return false;
    if (quotedMsg.viewOnceMessage) return true;
    if (quotedMsg.viewOnceMessageV2) return true;
    if (quotedMsg.viewOnceMessageV2Extension) return true;
    if (quotedMsg.viewOnceMessageV3) return true;
    if (quotedMsg.ptvMessage) return true;
    if (quotedMsg.imageMessage?.viewOnce) return true;
    if (quotedMsg.videoMessage?.viewOnce) return true;
    if (quotedMsg.audioMessage?.viewOnce) return true;
    return false;
}

// ==========================================
// CONSTRUCTION DE LA CAPTION AVEC LÉGENDE OPTIONNELLE
// ==========================================
function buildCaption(header, caption) {
    const cleanCaption = (caption || '').trim();
    if (cleanCaption) {
        return `${header}\n\n📝 *Légende :*\n${cleanCaption}`;
    }
    return header;
}

async function handleMessages(sock, m, botState) {
    if (m.type !== 'notify') return;

    for (const rawMsg of m.messages) {
        incrementMessagesReceived();
        if (!rawMsg || !rawMsg.message) continue;
        try {
            await processSingleMessage(sock, rawMsg, botState);
        } catch (e) {
            console.error('⚠️ Erreur traitement message:', e.message);
        }
    }
}

async function processSingleMessage(sock, rawMsg, botState) {
    let msg = unwrapMessageInPlace(JSON.parse(JSON.stringify(rawMsg)));

    const content = msg.message;
    if (!content) return;
    const msgType = Object.keys(content)[0];

    const chatId = msg.key.remoteJid || '';
    const messageId = msg.key.id;
    const myJid = `${String(botState.PHONE_NUMBER).replace(/\D/g, '')}@s.whatsapp.net`;
    const isFromMe = msg.key.fromMe;
    const isGroup = chatId.endsWith('@g.us');
    const sender = isGroup ? msg.key.participant : chatId;
    const senderNumber = sender ? sender.split('@')[0].split(':')[0] : '';
    if (sender && !sender.endsWith('@g.us') && msg.pushName && botState.profileNames) {
        botState.profileNames[jidNormalizedUser(sender)] = String(msg.pushName).trim();
    }
    const ownerNumber = String(botState.PHONE_NUMBER || process.env.OWNER_NUMBER || '').replace(/\D/g, '');
    const isOwner = isFromMe || (ownerNumber && senderNumber === ownerNumber);
    const protocolMessage = content.protocolMessage;
    const isRevoke = msgType === 'protocolMessage'
        && (protocolMessage?.type === 0 || protocolMessage?.type === 'REVOKE');

    if (isRevoke) {
        console.log(`🗑️ [ANTI-DELETE] Révocation reçue | chat=${chatId} | id=${protocolMessage?.key?.id || '?'}`);
    }

    // ==========================================
    // STATUTS
    // ==========================================
    if (chatId === 'status@broadcast') {
        const rawSender = msg.key.participant;
        if (!rawSender) return;
        const senderJid = jidNormalizedUser(rawSender);

        // STATUT SUPPRIMÉ
        if (isRevoke) {
            const deletedId = content.protocolMessage?.key?.id;
        if (!deletedId) return;
            if (botState.statusCache[senderJid]) {
                const savedStatusObj = botState.statusCache[senderJid].find(s => s.id === deletedId);
                if (savedStatusObj) {
                    const displayInfo = await resolveDisplayName(sock, senderJid, botState);
                    if (displayInfo.name !== 'Contact WhatsApp') savedStatusObj.senderName = displayInfo.name;
                    if (displayInfo.number) savedStatusObj.senderNumber = displayInfo.number;
                    const headerInfo = `👤 *De :* *${displayInfo.name}*\n📢 *[STATUT SUPPRIMÉ]*`;

                    if (savedStatusObj.type === 'text') {
                        await sock.sendMessage(myJid, { text: buildCaption(headerInfo, savedStatusObj.text) });
                    } else if (savedStatusObj.localPath && fs.existsSync(savedStatusObj.localPath)) {
                        const buffer = fs.readFileSync(savedStatusObj.localPath);
                        const caption = buildCaption(headerInfo, savedStatusObj.caption);

                        if (savedStatusObj.type === 'image') await sock.sendMessage(myJid, { image: buffer, caption });
                        else if (savedStatusObj.type === 'video') await sock.sendMessage(myJid, { video: buffer, caption });
                        else if (savedStatusObj.type === 'audio') {
                            await sock.sendMessage(myJid, { text: headerInfo });
                            await sock.sendMessage(myJid, { audio: buffer, mimetype: savedStatusObj.mimetype || 'audio/ogg; codecs=opus', ptt: savedStatusObj.ptt });
                        }
                    }
                    savedStatusObj.seen = true;
                }
            }
            return;
        }

        // NOUVEAU STATUT → capture en cache
        const isText = !!(content.extendedTextMessage?.text || content.conversation);
        const isImage = !!content.imageMessage;
        const isVideo = !!content.videoMessage;
        const isAudio = !!(content.audioMessage || content.pttMessage);

        if (!isText && !isImage && !isVideo && !isAudio) return;

        if (!Array.isArray(botState.statusCache[senderJid])) {
            botState.statusCache[senderJid] = [];
        }
        const exists = botState.statusCache[senderJid].some(s => s.id === messageId);

        if (!exists) {
            let localPath = null;
            let mediaType = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'text';

            if (mediaType !== 'text') {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const ext = isImage ? '.jpg' : isVideo ? '.mp4' : '.ogg';
                    localPath = path.join(botState.DIRS.statuts, `${messageId}${ext}`);
                    fs.writeFileSync(localPath, buffer);
                } catch (e) { }
            }

            // ✅ CAPTURE DE LA LÉGENDE POUR LES STATUTS
            const statusCaption = content.imageMessage?.caption
                                || content.videoMessage?.caption
                                || '';

            const statusDisplay = await resolveDisplayName(sock, senderJid, botState);
            const statusObj = {
                id: messageId,
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
                senderName: statusDisplay.name,
                senderNumber: statusDisplay.number || '',
                type: mediaType,
                localPath: localPath,
                text: content.extendedTextMessage?.text || content.conversation || '',
                caption: statusCaption,
                mimetype: content.audioMessage?.mimetype || 'audio/ogg; codecs=opus',
                ptt: content.audioMessage?.ptt || content.pttMessage?.ptt || false,
                seen: false
            };

            botState.statusCache[senderJid].push(statusObj);

            if (!botState.isSavingStatus) {
                botState.isSavingStatus = true;
                fsPromises.writeFile(botState.STATUS_JSON, JSON.stringify(botState.statusCache, null, 2))
                    .catch(() => { })
                    .finally(() => botState.isSavingStatus = false);
            }
        }
        return;
    }

    // CACHE ANTI-DELETE
    if (messageId) {
        if (botState.cacheMessages.size >= 3000) botState.cacheMessages.delete(botState.cacheMessages.keys().next().value);
        botState.cacheMessages.set(messageId, rawMsg);
    }

    // ==========================================
    // REPLY-VO (avec légende)
    // ==========================================
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.stickerMessage?.contextInfo
        || msg.message?.audioMessage?.contextInfo
        || msg.message?.documentMessage?.contextInfo;

    if (isFromMe && contextInfo?.quotedMessage && isQuotedViewOnce(contextInfo.quotedMessage)) {
        console.log('🦅 [REPLY-VO] Toi → récupération...');
        const quotedMsg = contextInfo.quotedMessage;
        const quotedId = contextInfo.stanzaId;
        const quotedParticipant = contextInfo.participant;

        try {
            const fakeMsg = {
                key: { remoteJid: chatId, fromMe: false, id: quotedId, participant: quotedParticipant },
                message: quotedMsg
            };
            const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {}, {
                logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest
            });

            if (buffer && buffer.length > 0) {
                const inner = quotedMsg.viewOnceMessageV2?.message
                    || quotedMsg.viewOnceMessage?.message
                    || quotedMsg.viewOnceMessageV2Extension?.message
                    || quotedMsg.viewOnceMessageV3?.message
                    || (quotedMsg.ptvMessage ? { videoMessage: quotedMsg.ptvMessage } : null)
                    || quotedMsg;
                const type = Object.keys(inner)[0];
            const displayInfo = await resolveDisplayName(sock, quotedParticipant || chatId, botState);
                const chatName = await getChatName(sock, chatId, botState);

                const headerInfo = `╭━━━〔 👁️ VUE UNIQUE RÉCUPÉRÉE 〕━━━╮\n┃ 👤 De : *${displayInfo.name}*\n┃ 💬 Dans : ${chatName}\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

                // ✅ CAPTURE DE LA LÉGENDE
                const voCaption = inner.imageMessage?.caption
                                || inner.videoMessage?.caption
                                || '';
                const finalCaption = buildCaption(headerInfo, voCaption);

                if (type === 'imageMessage') {
                    await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                } else if (type === 'videoMessage') {
                    await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                } else if (type === 'audioMessage' || type === 'pttMessage') {
                    const meta = inner.audioMessage || inner.pttMessage;
                    await sock.sendMessage(myJid, { text: headerInfo });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: meta?.mimetype || 'audio/ogg; codecs=opus', ptt: true });
                }
                console.log(`✅ [REPLY-VO] Envoyé (${displayInfo.name})${voCaption ? ' + légende' : ''}`);
            }
        } catch (e) {
            console.error(`❌ [REPLY-VO] Erreur : ${e.message}`);
        }
    }

    // ==========================================
    // VUE UNIQUE AUTO (avec légende)
    // ==========================================
    if (msg.wasViewOnce && !isFromMe) {
        const displayInfo = await resolveDisplayName(sock, sender, botState);
        const chatName = await getChatName(sock, chatId, botState);
        const headerInfo = `╭━━━〔 👁️ VUE UNIQUE 〕━━━╮\n┃ 👤 De : *${displayInfo.name}*\n┃ 💬 Dans : ${chatName}\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;

        const isImage = !!content.imageMessage;
        const isVideo = !!content.videoMessage;
        const isAudio = !!(content.audioMessage || content.pttMessage);

        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest });

            // ✅ CAPTURE DE LA LÉGENDE
            const mediaCaption = content.imageMessage?.caption || content.videoMessage?.caption || '';
            const finalCaption = buildCaption(headerInfo, mediaCaption);

            if (buffer) {
                if (isImage) await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
                else if (isVideo) await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
                else if (isAudio) {
                    const audioMeta = content.audioMessage || content.pttMessage;
                    await sock.sendMessage(myJid, { text: headerInfo });
                    await sock.sendMessage(myJid, { audio: buffer, mimetype: audioMeta?.mimetype || 'audio/ogg; codecs=opus', ptt: audioMeta?.ptt || false });
                }
            }
        } catch (err) { }
    }

    // ==========================================
    // ANTI-DELETE COMPLET : auteur de la suppression + contenu intégral
    // ==========================================
    if (isRevoke) {
        const protocol = content.protocolMessage;
        const deletedId = protocol.key?.id;
        if (!deletedId) return;

        const savedMsg = botState.cacheMessages.get(deletedId);
        if (!savedMsg?.message) {
            console.log(`⚠️ [ANTI-DELETE] Message introuvable dans le cache : ${deletedId}`);
            return;
        }

        const savedUnwrapped = unwrapMessageInPlace(JSON.parse(JSON.stringify(savedMsg)));
        const realDeletedContent = savedUnwrapped.message || {};
        const targetChatId = savedMsg.key.remoteJid || chatId;
        const originalSenderJid = jidNormalizedUser(savedMsg.key.participant || savedMsg.key.remoteJid || '');

        // Dans un groupe, le participant de l’événement protocolMessage est
        // la personne qui a supprimé le message. En privé, le remoteJid joue
        // le même rôle. Ce n’est pas nécessairement l’auteur original.
        const deleterRaw = isGroup
            ? (msg.key.participant || msg.key.remoteJid)
            : (msg.key.remoteJid || msg.key.participant);
        const deleterJid = jidNormalizedUser(deleterRaw || '');
        const deleter = await resolveDisplayName(sock, deleterJid, botState);
        const originalSender = await resolveDisplayName(sock, originalSenderJid, botState);
        const chatName = await getChatName(sock, targetChatId, botState);
        const headerInfo = `╭━━━〔 🗑️ MESSAGE SUPPRIMÉ 〕━━━╮\n┃ 👤 Supprimé par : *${deleter.name}*\n┃ 📨 Envoyé par : *${originalSender.name}*\n┃ 💬 Conversation : ${chatName}\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;

        const textDeleted = realDeletedContent.conversation
            || realDeletedContent.extendedTextMessage?.text
            || '';
        const image = realDeletedContent.imageMessage;
        const video = realDeletedContent.videoMessage;
        const audio = realDeletedContent.audioMessage || realDeletedContent.pttMessage;
        const sticker = realDeletedContent.stickerMessage;
        const document = realDeletedContent.documentMessage;
        const contact = realDeletedContent.contactMessage;
        const contacts = realDeletedContent.contactsArrayMessage;
        const location = realDeletedContent.locationMessage || realDeletedContent.liveLocationMessage;
        const caption = image?.caption || video?.caption || document?.caption || '';

        if (textDeleted) {
            await sock.sendMessage(myJid, { text: `${headerInfo}\n\n📝 *Contenu :*\n${textDeleted}` });
            return;
        }

        if (contact || contacts || location) {
            const detail = contact?.displayName
                || contacts?.contacts?.map(c => c.displayName).filter(Boolean).join(', ')
                || location?.name
                || 'Contenu structuré';
            await sock.sendMessage(myJid, { text: `${headerInfo}\n\n📦 *Contenu :* ${detail}` });
            return;
        }

        if (!image && !video && !audio && !sticker && !document) {
            const typeLabel = Object.keys(realDeletedContent)[0] || 'inconnu';
            await sock.sendMessage(myJid, { text: `${headerInfo}\n\n📦 *Type récupéré :* ${typeLabel}` });
            return;
        }

        try {
            const buffer = await downloadMediaMessage(
                { key: savedMsg.key, message: realDeletedContent },
                'buffer', {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.reuploadRequest }
            );
            if (!buffer || buffer.length === 0) throw new Error('média absent ou déjà expiré');

            const finalCaption = buildCaption(headerInfo, caption);
            if (image) {
                await sock.sendMessage(myJid, { image: buffer, caption: finalCaption });
            } else if (video) {
                await sock.sendMessage(myJid, { video: buffer, caption: finalCaption });
            } else if (audio) {
                await sock.sendMessage(myJid, { text: headerInfo });
                await sock.sendMessage(myJid, {
                    audio: buffer,
                    mimetype: audio.mimetype || 'audio/ogg; codecs=opus',
                    ptt: Boolean(audio.ptt)
                });
            } else if (sticker) {
                await sock.sendMessage(myJid, { text: headerInfo });
                await sock.sendMessage(myJid, { sticker: buffer });
            } else if (document) {
                await sock.sendMessage(myJid, { text: finalCaption });
                await sock.sendMessage(myJid, {
                    document: buffer,
                    mimetype: document.mimetype || 'application/octet-stream',
                    fileName: document.fileName || 'fichier récupéré'
                });
            }
            console.log(`✅ [ANTI-DELETE] Récupéré : ${deleter.name} → ${originalSender.name}`);
        } catch (error) {
            await sock.sendMessage(myJid, {
                text: `${headerInfo}\n\n⚠️ *Le média a été identifié mais ne peut plus être téléchargé.*\n_Raison : ${error.message}_`
            });
            console.error(`⚠️ [ANTI-DELETE] Média indisponible : ${error.message}`);
        }
        return;
    }

    // COMMANDES
    if (!isOwner) return;

    let text = content.conversation || content.extendedTextMessage?.text || '';
    if (content.imageMessage?.caption) text = content.imageMessage.caption;
    if (content.videoMessage?.caption) text = content.videoMessage.caption;

    if (!text || !text.startsWith(PREFIX)) return;

    const args = text.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    // 🥷 MODE FANTÔME (Désactivé si on s'écrit à soi-même dans "Vous")
    const isSelfChat = !isGroup && (senderNumber === String(botState.PHONE_NUMBER).replace(/\D/g, ''));
    
    if (commands.has(commandName) && !isSelfChat) {
        try {
            await sock.sendMessage(chatId, { delete: msg.key });
        } catch (err) { }
    }

    if (commands.has(commandName)) incrementCommand(commandName);
    await handleCommand(sock, msg, botState, {
        from: chatId, sender, senderNumber, isGroup, isFromMe, isOwner,
        commandName, args, text
    });
}

function handleReceipts(events, botState) {
    for (const receipt of events) {
        const targetId = receipt.key.id;
        for (const jid in botState.statusCache) {
            if (!Array.isArray(botState.statusCache[jid])) continue;
            const item = botState.statusCache[jid].find(s => s.id === targetId);
            if (item) { item.seen = true; break; }
        }
    }
}

module.exports = { handleMessages, handleReceipts };
