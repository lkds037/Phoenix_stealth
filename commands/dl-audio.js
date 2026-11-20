const { YtDlp } = require('ytdlp-nodejs');
const ytdlp = new YtDlp();

module.exports = {
    name: 'dlaudio',
    // ...
    async execute(sock, msg, botState, ctx) {
        const url = (ctx.args || [])[0];
        // ... (vérifications de l'URL) ...

        try {
            await sock.sendMessage(ctx.from, { text: '⏳ Récupération du titre...' });

            // 1. Récupérer les métadonnées pour obtenir le titre original
            const info = await ytdlp.getInfoAsync(url);
            const audioTitle = info.title || 'Audio sans titre';

            await sock.sendMessage(ctx.from, { text: `🎧 Extraction de « ${audioTitle} » en cours...` });

            // 2. Extraire l'audio en Buffer
            const buffer = await ytdlp.stream(url)
                .filter('audioonly')
                .type('m4a')
                .toBuffer();

            // ... (vérification de la taille) ...

            // 3. Envoyer en note vocale (ptt: true) ou en fichier (ptt: false)
            await sock.sendMessage(ctx.from, {
                audio: buffer,
                mimetype: 'audio/mp4',
                fileName: `${audioTitle}.m4a`, // 👈 Le nom original est ici
                ptt: true // ou false si vous préférez un fichier audio classique
            });

        } catch (err) {
            // ... (gestion de l'erreur) ...
        }
    }
};
