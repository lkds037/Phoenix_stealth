const assert = require('node:assert/strict');
const alert = require('./core/onlineAlerts');
const tagall = require('./commands/tagall');
const statut = require('./commands/statut');
const { resolveDisplayName } = require('./core/displayNames');
const { classifyRTT } = require('./core/silentTracker');
const { handleMessages } = require('./core/messages');
const { resolveTargetJid } = require('./core/target');

(async () => {
  const state = { PHONE_NUMBER: '33123456789', contactNames: { '33111111111@s.whatsapp.net': 'Blue Bird' }, profileNames: {}, onlineAlerts: {}, ONLINE_ALERTS_JSON: '/tmp/phoenix-alerts-test.json', scheduleSaveContacts() {} };
  const sent = [];
  const sock = { sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'x' } }; }, groupMetadata: async () => ({ subject: 'Groupe Phoenix', participants: [{ id: '33111111111@s.whatsapp.net' }, { id: '33122222222@s.whatsapp.net' }] }) };
  const added = await alert.add(sock, state, 'Blue Bird', '🔔 {name} est là');
  assert.equal(added.ok, true);
  await alert.notify(sock, state, '33111111111:4@s.whatsapp.net', 'available');
  assert.match(sent.at(-1).content.text, /Blue Bird est là/);
  state.contactNames['33133333333@s.whatsapp.net'] = 'Ingrid';
  assert.equal((await resolveDisplayName(sock, '33133333333@s.whatsapp.net', state, 'Contact WhatsApp')).name, 'Ingrid');
  state.profileNames['33144444444@s.whatsapp.net'] = 'Profil Inconnu';
  assert.equal((await resolveDisplayName(sock, '33144444444@s.whatsapp.net', state)).name, 'Contact WhatsApp');
  assert.equal(resolveTargetJid('Blue Bird', { from: '33199999999@s.whatsapp.net' }, state).jid, '33111111111@s.whatsapp.net');
  assert.equal(resolveTargetJid('inconnu', { from: '33199999999@s.whatsapp.net' }, state), null);

  sent.length = 0;
  await tagall.execute(sock, { key: { remoteJid: '120@g.us', id: 'cmd' }, message: { extendedTextMessage: { contextInfo: { stanzaId: 'original-message', participant: '33111111111@s.whatsapp.net', quotedMessage: { conversation: 'hello' } } } } }, state, { from: '120@g.us', isGroup: true, args: ['rappel'], commandName: 'tagall' });
  assert.equal(sent.at(-1).options.quoted.id, 'original-message');
  assert.match(sent.at(-1).content.text, /Groupe Phoenix/);

  sent.length = 0;
  state.STATUS_JSON = '/tmp/phoenix-status-test.json';
  state.statusCache = { '33111111111@s.whatsapp.net': [{ id: 'status-1', seen: true, type: 'text', text: 'ancien statut', msg: { message: { conversation: 'ancien statut' } } }] };
  await statut.execute(sock, { key: { id: 'cmd2' } }, state, { args: ['download', 'Blue Bird', '-1'] });
  assert(sent.some(x => /ancien statut/.test(x.content.text || '')));
  assert(state.statusCache['33111111111@s.whatsapp.net']);
  const malformedState = { ...state, statusCache: { '33111111111@s.whatsapp.net': { broken: true } }, isSavingStatus: true, DIRS: { statuts: '/tmp' } };
  await handleMessages(sock, { type: 'notify', messages: [{ key: { remoteJid: 'status@broadcast', participant: '33111111111@s.whatsapp.net', id: 'fresh-status' }, message: { conversation: 'nouveau statut' } }] }, malformedState);
  assert.ok(Array.isArray(malformedState.statusCache['33111111111@s.whatsapp.net']));
  const rttResult = classifyRTT('33111111111@s.whatsapp.net', 600);
  assert.equal(rttResult.activity, 'état en ligne non confirmé');
  assert.equal(rttResult.state, 'reachable');
  console.log('PASS alertonline/tagall/status + online instantané');
})().catch((error) => { console.error(error); process.exit(1); });
