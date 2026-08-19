const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CLIENT_ID = '1536353977304621077';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YOUR_DISCORD_CLIENT_SECRET';
const REDIRECT_URI = 'https://dashchat-rsuk.onrender.com/auth/discord/callback';

const users = new Map(); 
const inviteCodes = new Map(); 

app.use(express.static(path.join(__dirname, 'views')));

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DashChat - Geometry Dash Global Chat</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1a1a24; color: #fff; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .card { background: #242438; border-radius: 12px; padding: 2rem; max-width: 450px; width: 100%; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        h1 { color: #5865F2; margin-bottom: 0.5rem; }
        p { color: #a3a3c2; font-size: 0.95rem; line-height: 1.5; }
        .btn { display: inline-flex; align-items: center; gap: 0.5rem; background: #5865F2; color: #fff; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: bold; margin-top: 1.5rem; transition: background 0.2s; }
        .btn:hover { background: #4752C4; }
        .token-box { background: #11111b; padding: 1rem; border-radius: 6px; word-break: break-all; margin-top: 1rem; font-family: monospace; color: #00ffcc; }
    </style>
</head>
<body>
    <div class="card">
        <h1><i class="fa-solid fa-comments"></i> DashChat</h1>
        <p>Connect your Discord account to get your token and join the real-time global chat in Geometry Dash!</p>
        <a href="https://discord.com/oauth2/authorize?client_id=1536353977304621077&response_type=code&redirect_uri=https%3A%2F%2Fdashchat-rsuk.onrender.com%2Fauth%2Fdiscord%2Fcallback&scope=identify" class="btn">
            <i class="fa-brands fa-discord"></i> Link Discord Account
        </a>
    </div>
</body>
</html>
`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('No code provided.');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const username = userResponse.data.username;
        const userToken = Buffer.from(`${username}:${Date.now()}`).toString('base64');
        users.set(userToken, username);

        res.send(`
            <body style="background:#1a1a24;color:#fff;font-family:sans-serif;text-align:center;padding:2rem;">
                <h2>Authentication Successful!</h2>
                <p>Copy this session token and paste it into DashChat Geode Settings:</p>
                <div style="background:#111;padding:1rem;color:#00ffcc;font-family:monospace;margin:1rem auto;max-width:400px;word-break:break-all;">${userToken}</div>
            </body>
        `);
    } catch (err) {
        res.status(500).send('Authentication failed.');
    }
});

app.get('/invite/:code', (req, res) => {
    const code = req.params.code;
    const levelID = inviteCodes.get(code);
    if (levelID) {
        res.send(`Redirecting to Level ID: ${levelID} in Geometry Dash...`);
    } else {
        res.status(404).send('Invalid Invite Code');
    }
});

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const token = urlParams.get('token');
    const username = users.get(token) || 'Guest_' + Math.floor(Math.random() * 1000);

    ws.send(JSON.stringify({
        sender: 'System',
        text: `Welcome ${username} to DashChat!`,
        color: '#00FF00'
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'chat') {
                const broadcastData = JSON.stringify({
                    sender: username,
                    text: data.text,
                    color: '#FFFFFF'
                });

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastData);
                    }
                });
            }
        } catch (e) {}
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
