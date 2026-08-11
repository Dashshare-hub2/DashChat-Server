require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });


const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });


const clients = new Map(); 
const privateSessions = new Map(); 

function generateSessionCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (privateSessions.has(code));
    return code;
}


async function isContentSafe(text) {
    if (!process.env.GEMINI_API_KEY) return true;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze this chat message for severe harassment, hate speech, explicit illegal acts, or extreme NSFW. Respond ONLY with "SAFE" or "UNSAFE". Message: "${text}"`
        });
        const result = response.text ? response.text.trim().toUpperCase() : 'SAFE';
        return !result.includes('UNSAFE');
    } catch (err) {
        console.error('Gemini Moderation Error:', err.message);
        return true; 
    }
}

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code parameter.');

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        const user = userRes.data;
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` 
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || 0) % 5}.png`;

        const authPayload = {
            id: user.id,
            username: user.global_name || user.username,
            avatarUrl: avatarUrl
        };

        const encodedToken = Buffer.from(JSON.stringify(authPayload)).toString('base64');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>DashChat Discord Auth</title></head>
            <body style="background:#18191c; color:#fff; font-family:sans-serif; text-align:center; padding-top:50px;">
                <h2 style="color:#5865F2;">Discord Connected Successfully!</h2>
                <p>Copy your Link Code below and paste it into Geometry Dash Settings:</p>
                <div style="background:#2f3136; padding:15px; margin:20px auto; width:80%; max-width:500px; word-break:break-all; border-radius:8px;">
                    <code style="font-size:16px; color:#57F287;" id="token">${encodedToken}</code>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Discord Auth Error:', err.response?.data || err.message);
        res.status(500).send('Discord Authentication Failed.');
    }
});

wss.on('connection', (ws) => {
    clients.set(ws, { sessionCode: null, levelID: 0, discordUser: null, gdName: 'Player' });

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const client = clients.get(ws);

            switch (data.type) {
                case 'INIT':
                    client.gdName = data.gdName || 'Player';
                    if (data.discordToken) {
                        try {
                            client.discordUser = JSON.parse(Buffer.from(data.discordToken, 'base64').toString('utf8'));
                        } catch (e) {
                            client.discordUser = null;
                        }
                    }
                    break;

                case 'CREATE_PRIVATE':
                    const newCode = generateSessionCode();
                    client.sessionCode = newCode;
                    privateSessions.set(newCode, new Set([ws]));
                    ws.send(JSON.stringify({ type: 'PRIVATE_CREATED', code: newCode }));
                    break;

                case 'JOIN_PRIVATE':
                    if (privateSessions.has(data.code)) {
                        client.sessionCode = data.code;
                        privateSessions.get(data.code).add(ws);
                        ws.send(JSON.stringify({ type: 'PRIVATE_JOINED', code: data.code }));
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Private session code not found.' }));
                    }
                    break;

                case 'UPDATE_LEVEL':
                    client.levelID = data.levelID || 0;
                    break;

                case 'CHAT':
                    const safe = await isContentSafe(data.message);
                    if (!safe) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Message blocked by AI Moderation.' }));
                        return;
                    }

                    const payload = {
                        type: 'MESSAGE',
                        senderGD: client.gdName,
                        discordUser: client.discordUser,
                        message: data.message,
                        levelID: client.levelID,
                        scope: data.scope
                    };

                    if (data.scope === 'private' && client.sessionCode) {
                        const room = privateSessions.get(client.sessionCode);
                        if (room) {
                            room.forEach(peer => {
                                if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(payload));
                            });
                        }
                    } else if (data.scope === 'level') {
                        wss.clients.forEach(peer => {
                            const pData = clients.get(peer);
                            if (peer.readyState === WebSocket.OPEN && pData && pData.levelID === client.levelID) {
                                peer.send(JSON.stringify(payload));
                            }
                        });
                    } else { 
                        wss.clients.forEach(peer => {
                            if (peer.readyState === WebSocket.OPEN) peer.send(JSON.stringify(payload));
                        });
                    }
                    break;
            }
        } catch (err) {
            console.error('Socket Payload Handling Error:', err);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        if (client && client.sessionCode && privateSessions.has(client.sessionCode)) {
            const room = privateSessions.get(client.sessionCode);
            room.delete(ws);
            if (room.size === 0) privateSessions.delete(client.sessionCode);
        }
        clients.delete(ws);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DashChat Server running on port ${PORT}`));
