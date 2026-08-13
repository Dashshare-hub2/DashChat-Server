const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CLIENT_ID = '1536353977304621077';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = 'https://dashchat-rsuk.onrender.com/auth/discord/callback';

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query; 

    if (!code) {
        return res.status(400).send('Missing authorization code.');
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', 
            new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const userData = userResponse.data;
        const discordName = userData.username;
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;

        const payload = JSON.stringify({
            type: 'discord_linked',
            state: state || '',
            discordName: discordName,
            discordAvatarUrl: avatarUrl
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });

        res.send('<h2>Discord authentication successful! You can return to Geometry Dash.</h2>');

    } catch (error) {
        console.error('OAuth2 Error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed.');
    }
});

wss.on('connection', (ws) => {
    ws.room = 'global';

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'join_room') {
                ws.room = msg.roomCode;
                return;
            }

            if (msg.type === 'chat') {
                const payload = JSON.stringify({
                    type: 'chat',
                    discordAvatarUrl: msg.discordAvatarUrl || '',
                    playerIconId: msg.playerIconId || '1',
                    discordName: msg.discordName || 'Guest',
                    playerName: msg.playerName || 'Player',
                    message: msg.message,
                    room: ws.room
                });

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client.room === ws.room) {
                        client.send(payload);
                    }
                });
            }
        } catch (e) {
            console.error('Error parsing WS message:', e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
