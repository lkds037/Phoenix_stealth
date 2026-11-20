const { YtDlp } = require('ytdlp-nodejs');
const ytdlp = new YtDlp();

module.exports = {
    name: 'dl',
    // ...
    async execute(sock, msg, botState, ctx) {
        const url = (ctx.args || [])[0];
        // ... (vérifications de l'URL) ...

        try {
            await sock.sendMessage(ctx.from, { text: '⏳ Récupération du titre...' });

            // 1. Récupérer les métadonnées pour obtenir le titre original
            const info = await ytdlp.getInfoAsync(url);
            const videoTitle = info.title || 'Vidéo sans titre';

            await sock.sendMessage(ctx.from, { text: `📥 Téléchargement de « ${videoTitle} » en cours...` });

            // 2. Télécharger la vidéo en Buffer
            const buffer = await ytdlp.stream(url)
                .filter('mergevideo')
                .quality('720p')
                .type('mp4')
                .toBuffer();

            // ... (vérification de la taille) ...

            // 3. Envoyer avec le nom de fichier personnalisé
            await sock.sendMessage(ctx.from, {
                video: buffer,
                mimetype: 'video/mp4',
                fileName: `${videoTitle}.mp4`, // 👈 Le nom original est ici
                caption: `✅ ${videoTitle}`
            });

        } catch (err) {
            // ... (gestion de l'erreur) ...
        }
    }
};
