const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1536353977304621077';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YOUR_DISCORD_CLIENT_SECRET';
const REDIRECT_URI = 'https://dashchat-rsuk.onrender.com/auth/discord/callback';

const inviteCodes = new Set(['DASH2026', 'GEODECHAT', 'VIPACCESS']);
const linkedUsers = new Map();
const activeSockets = new Map(); 

app.use(express.json());

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>DashChat - Geometry Dash Global Chat Mod</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0f15; color: #fff; text-align: center; margin: 0; padding: 40px 20px; }
            .container { max-width: 800px; margin: 0 auto; background: #1a1a24; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
            h1 { color: #5865F2; font-size: 2.5rem; }
            p { color: #aaa; font-size: 1.1rem; line-height: 1.6; }
            .features { display: flex; justify-content: space-around; margin: 40px 0; flex-wrap: wrap; gap: 20px; }
            .card { background: #252533; padding: 20px; border-radius: 8px; width: 30%; min-width: 200px; }
            .card i { font-size: 2.5rem; color: #5865F2; margin-bottom: 15px; }
            .btn { display: inline-block; background: #5865F2; color: #fff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; transition: 0.2s; }
            .btn:hover { background: #4752C4; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1><i class="fa-solid fa-comments"></i> DashChat Server</h1>
            <p>Hệ thống Realtime Global Chat dành cho Geometry Dash Mod</p>
            
            <div class="features">
                <div class="card">
                    <i class="fa-solid fa-bolt"></i>
                    <h3>Realtime WebSocket</h3>
                    <p>Nhận và gửi tin nhắn tức thì bằng hạ tầng WebSocket tối ưu.</p>
                </div>
                <div class="card">
                    <i class="fa-brands fa-discord"></i>
                    <h3>Discord Integration</h3>
                    <p>Xác thực danh tính an toàn thông qua tài khoản Discord.</p>
                </div>
                <div class="card">
                    <i class="fa-solid fa-key"></i>
                    <h3>Invite System</h3>
                    <p>Hệ thống mã mời bảo mật cộng đồng chất lượng cao.</p>
                </div>
            </div>

            <a href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=identify" class="btn">
                <i class="fa-brands fa-discord"></i> Liên kết Discord
            </a>
        </div>
    </body>
    </html>
    `);
});

app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query; // state chứa accountID GD từ Mod gửi lên
    if (!code) return res.status(400).send('Trạng thái không hợp lệ hoặc thiếu Code.');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `${tokenResponse.data.token_type} ${tokenResponse.data.access_token}` }
        });

        const discordUser = userResponse.data;
        
        if (state) {
            linkedUsers.set(state.toString(), discordUser);
        }

        res.send(`
            <div style="text-align:center; padding: 50px; font-family: sans-serif; background: #0f0f15; color: #fff; height: 100vh;">
                <h1 style="color: #43b581;"><i class="fa-solid fa-circle-check"></i> Xác thực thành công!</h1>
                <p>Tài khoản Discord <strong>${discordUser.username}</strong> đã được liên kết thành công với DashChat.</p>
                <p>Bạn có thể đóng trình duyệt này và quay lại Geometry Dash.</p>
            </div>
        `);
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).send('Đã có lỗi xảy ra trong quá trình xác thực Discord.');
    }
});

wss.on('connection', (ws) => {
    let currentAccountID = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'auth': {
                    const { accountID, username, inviteCode } = data;

     
                    if (!inviteCodes.has(inviteCode)) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Mã Invite Code không hợp lệ!' }));
                        return;
                    }

                    currentAccountID = accountID.toString();
                    activeSockets.set(currentAccountID, ws);

                    ws.send(JSON.stringify({ 
                        type: 'auth_success', 
                        message: 'Kết nối DashChat Server thành công!',
                        isLinked: linkedUsers.has(currentAccountID)
                    }));
                    break;
                }

                case 'chat': {
                    if (!currentAccountID) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Bạn chưa xác thực!' }));
                        return;
                    }

                    const broadcastMsg = JSON.stringify({
                        type: 'chat',
                        sender: data.sender || 'Unknown',
                        message: data.message,
                        accountID: currentAccountID
                    });

          
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(broadcastMsg);
                        }
                    });
                    break;
                }
            }
        } catch (err) {
            console.error('Lỗi tin nhắn WS:', err);
        }
    });

    ws.on('close', () => {
        if (currentAccountID) {
            activeSockets.delete(currentAccountID);
        }
    });
});

server.listen(PORT, () => {
    console.log(`[DashChat Server] Đang chạy tại port ${PORT}`);
});
