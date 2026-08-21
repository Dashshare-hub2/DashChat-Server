require('dotenv').config();
const express = require('express');
const { Server } = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;
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


app.get('/', (req, res) => {
    const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>DashChat Auth</title>
            <style>
                body { font-family: sans-serif; background: #121212; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e1e1e; padding: 2rem; border-radius: 12px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
                a { display: inline-block; margin-top: 1rem; padding: 10px 20px; background: #5865F2; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
                a:hover { background: #4752C4; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>DashChat Overlay</h1>
                <p>Login with Discord</p>
                <a href="${discordAuthUrl}">Login with Discord</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Missing authorization code');
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = userResponse.data;

        const isGif = user.avatar && user.avatar.startsWith('a_');
        const ext = isGif ? 'gif' : 'png';
        const avatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
            : `https://cdn.discordapp.com/embed/avatars/${user.discriminator % 5}.png`;

        const token = jwt.sign(
            { id: user.id, username: user.username, avatar: avatarUrl }, 
            JWT_SECRET, 
            { expiresIn: '30d' }
        );

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>DashChat - Token Success</title>
                <style>
                    body { font-family: sans-serif; background: #121212; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .card { background: #1e1e1e; padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
                    .avatar { width: 80px; height: 80px; border-radius: 50%; margin-bottom: 1rem; border: 2px solid #5865F2; }
                    .token-box { background: #000; padding: 10px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 12px; margin: 1rem 0; border: 1px solid #333; color: #00ff66; }
                    button { padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
                    button:hover { background: #218838; }
                </style>
            </head>
            <body>
                <div class="card">
                    <img class="avatar" src="${avatarUrl}" alt="Avatar" />
                    <h2>Hi, ${user.username}!</h2>
                    <p style="font-size: 13px; color: #aaa;">Sao chép mã Session Token bên dưới và dán vào phần Cài đặt của Mod DashChat trong Geometry Dash:</p>
                    
                    <div class="token-box" id="jwtToken">${token}</div>
                    
                    <button onclick="copyToken()">Copy Token</button>
                </div>

                <script>
                    function copyToken() {
                        const tokenText = document.getElementById('jwtToken').innerText;
                        navigator.clipboard.writeText(tokenText).then(() => {
                            alert('Đã copy Token vào bộ nhớ tạm!');
                        });
                    }
                </script>
            </body>
            </html>
        `);

    } catch (err) {
        console.error("Callback error:", err.response?.data || err.message);
        res.status(500).send('Authentication failed. Please try again.');
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
