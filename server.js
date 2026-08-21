require('dotenv').config();
const express = require('express');
const { Server } = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

app.use(express.json());

app.post('/api/auth/discord', async (req, res) => {
    const { code } = req.body;

    if (!code) return res.status(400).json({ error: 'Code is required' });

    try {
        const tokenResponse = await axios.post('https://discord-proxy.dashshare.workers.dev/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord-proxy.dashshare.workers.dev/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = userResponse.data;

        const isGif = user.avatar && user.avatar.startsWith('a_');
        const ext = isGif ? 'gif' : 'png';
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;

        const token = jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                avatar: avatarUrl 
            }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
        );

        res.json({ token, username: user.username, avatar: avatarUrl });
    } catch (err) {
        console.error("Auth error:", err.response?.data || err.message);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const wss = new Server({ server });

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const token = urlParams.get('token');

    let userData = { username: 'Guest', avatar: '' };

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            userData = { username: decoded.username, avatar: decoded.avatar };
            console.log(`Authenticated: ${userData.username}`);
        } catch (err) {
            console.log('Invalid JWT token');
        }
    }

    ws.on('message', (message) => {
        try {
            const payload = JSON.parse(message);
            
            if (!payload.text) return;

            const broadcastData = JSON.stringify({
                sender: userData.username,
                avatar: userData.avatar,
                text: payload.text,
                color: '#FFFFFF'
            });

            wss.clients.forEach((client) => {
                if (client.readyState === ws.OPEN) {
                    client.send(broadcastData);
                }
            });
        } catch (e) {
            console.error('Invalid message format');
        }
    });
});
