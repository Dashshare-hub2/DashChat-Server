const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const linkedAccounts = new Map();

const VALID_INVITE_CODES = new Set(['DASH-GLOBAL-CHAT', 'GEODE-VIP']);

console.log(`🚀 DashChat Extended Server running on port ${PORT}`);

wss.on('connection', (ws) => {
    ws.isAuthed = false;
    ws.gdName = 'Guest';
    ws.discordInfo = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            switch (data.type) {
                case 'join_invite': {
                    const code = data.inviteCode ? data.inviteCode.toUpperCase() : '';
                    if (VALID_INVITE_CODES.has(code) || code.startsWith('DASH-')) {
                        ws.isAuthed = true;
                        ws.gdName = data.gdName || 'Guest';
                        ws.discordInfo = linkedAccounts.get(ws.gdName) || null;

                        ws.send(JSON.stringify({
                            type: 'join_success',
                            message: `Joined (${code})`,
                            discordLinked: !!ws.discordInfo
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invite code not found!'
                        }));
                    }
                    break;
                }

                case 'link_discord': {
                    const { gdName, discordUsername, discordId } = data;
                    if (gdName && discordId) {
                        const info = { discordUsername, discordId };
                        linkedAccounts.set(gdName, info);
                        ws.discordInfo = info;

                        ws.send(JSON.stringify({
                            type: 'link_success',
                            message: `Linked Discord Account: ${discordUsername}`
                        }));
                    }
                    break;
                }

                case 'chat_message': {
                    if (!ws.isAuthed) {
                        ws.send(JSON.stringify({ type: 'error', message: 'You must enter invite code to chat!' }));
                        return;
                    }

                    const broadcastData = JSON.stringify({
                        type: 'chat_message',
                        sender: ws.gdName,
                        discordUser: ws.discordInfo ? ws.discordInfo.discordUsername : null,
                        message: data.message || ''
                    });

                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN && client.isAuthed) {
                            client.send(broadcastData);
                        }
                    });
                    break;
                }
            }
        } catch (err) {
            console.error('❌ Error processing message:', err);
        }
    });
});
