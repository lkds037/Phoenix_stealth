const HEARTBEAT_MS = 3000;

function ensureState(botState) {
    if (!botState.activeIntervals || typeof botState.activeIntervals !== 'object') {
        botState.activeIntervals = {};
    }
    if (!botState.presenceModes || typeof botState.presenceModes !== 'object') {
        botState.presenceModes = {};
    }
}

function clearLoop(botState, targetJid) {
    ensureState(botState);
    const timer = botState.activeIntervals[targetJid];
    if (timer) clearInterval(timer);
    delete botState.activeIntervals[targetJid];
}

async function start(sock, botState, targetJid, mode) {
    ensureState(botState);
    clearLoop(botState, targetJid);
    botState.presenceModes[targetJid] = mode;

    let busy = false;
    const tick = async () => {
        if (busy) return true;
        if (botState.currentSock && botState.currentSock !== sock) {
            clearLoop(botState, targetJid);
            return false;
        }
        busy = true;
        try {
            await sock.sendPresenceUpdate(mode, targetJid);
            return true;
        } catch (_) {
            clearLoop(botState, targetJid);
            return false;
        } finally {
            busy = false;
        }
    };

    const firstTickSucceeded = await tick();
    if (!firstTickSucceeded) return false;
    const timer = setInterval(tick, HEARTBEAT_MS);
    botState.activeIntervals[targetJid] = timer;
    timer.unref?.();
    return true;
}

function stop(botState, targetJid) {
    ensureState(botState);
    clearLoop(botState, targetJid);
    delete botState.presenceModes[targetJid];
}

async function resumeAll(sock, botState) {
    ensureState(botState);
    const modes = Object.entries(botState.presenceModes);
    for (const [targetJid, mode] of modes) {
        await start(sock, botState, targetJid, mode);
    }
}

module.exports = { HEARTBEAT_MS, start, stop, resumeAll, clearLoop };
