const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

const CLIENT_ID = '1536353977304621077';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = 'https://dashchat-rsuk.onrender.com/auth/discord/callback';

const activeSessions = new Map(); 

app.get('/auth/discord', (req, res) => {
    const gdUser = req.query.gdUser || 'Player';
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${encodeURIComponent(gdUser)}`;
    res.redirect(authUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Authorization code missing.');

    try {
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
            }),
        });
        const tokenData = await tokenResponse.json();

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `${tokenData.token_type} ${tokenData.access_token}` },
        });
        const userData = await userResponse.json();

        const authToken = Math.random().toString(36).substring(2, 10).toUpperCase();
        const avatarUrl = userData.avatar 
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${userData.discriminator % 5}.png`;

        activeSessions.set(authToken, {
            discordId: userData.id,
            discordName: userData.username,
            avatarUrl: avatarUrl
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>DashChat Authentication</title>
                <style>
                    body { font-family: Arial, sans-serif; background: #121212; color: #fff; text-align: center; padding: 50px; }
                    .card { background: #1e1e2f; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                    .code { font-size: 28px; font-weight: bold; color: #00ffcc; letter-spacing: 2px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Discord Account Connected!</h2>
                    <p>Copy this Auth Token and paste it into your Geometry Dash Chat Mod:</p>
                    <div class="code">${authToken}</div>
                    <p style="color: #aaa;">You can now close this tab.</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send('Authentication Error.');
    }
});

io.on('connection', (socket) => {
    let userData = {
        gdUser: 'Guest',
        discordName: null,
        avatarUrl: null,
        currentRoom: 'global'
    };

    socket.join('global');

    socket.on('authenticate', (data) => {
        const session = activeSessions.get(data.authToken);
        if (session) {
            userData.discordName = session.discordName;
            userData.avatarUrl = session.avatarUrl;
            userData.gdUser = data.gdUser || 'Player';
            socket.emit('auth-success', { discordName: session.discordName, avatarUrl: session.avatarUrl });
        } else {
            socket.emit('auth-failed', { message: 'Invalid or expired auth token.' });
        }
    });

    socket.on('join-room', (roomCode) => {
        if (!/^\d{6}$/.test(roomCode)) {
            return socket.emit('error-msg', 'Room code must be a 6-digit number!');
        }
        socket.leave(userData.currentRoom);
        userData.currentRoom = roomCode;
        socket.join(roomCode);
        socket.emit('room-joined', { room: roomCode });
    });

    socket.on('join-global', () => {
        socket.leave(userData.currentRoom);
        userData.currentRoom = 'global';
        socket.join('global');
        socket.emit('room-joined', { room: 'global' });
    });

    socket.on('send-message', (content) => {
        if (!content || content.trim().length === 0) return;

        const payload = {
            discordName: userData.discordName || 'Guest',
            gdUser: userData.gdUser || 'Player',
            avatarUrl: userData.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
            message: content.trim(),
            room: userData.currentRoom,
            timestamp: Date.now()
        };

        io.to(userData.currentRoom).emit('receive-message', payload);
    });

    socket.on('invite-player', (data) => {
        io.emit('player-invited', {
            inviterGD: userData.gdUser,
            targetGD: data.targetGD,
            roomCode: data.roomCode,
            inviteUrl: `https://dashchat-rsuk.onrender.com/join/${data.roomCode}`
        });
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`DashChat Server running on port ${PORT}`);
});
