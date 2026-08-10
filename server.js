const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const session = require('express-session');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const connectedUsers = new Map(); 

app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'geode-secret-key',
  resave: false,
  saveUninitialized: false
}));


async function filterMessage(text) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze and sanitize the following chat message. If it contains offensive language, toxicity, or slurs in ANY language, return a sanitized version with inappropriate words replaced by stars (***). Return ONLY the sanitized string without extra comments.\n\nMessage: "${text}"`
    });
    return response.text.trim();
  } catch (err) {
    console.error('AI Moderation Error:', err);
    return text; 
  }
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('register_user', (userData) => {
    connectedUsers.set(socket.id, {
      socketId: socket.id,
      gdUsername: userData.gdUsername || 'CubePlayer',
      discordId: userData.discordId || null,
      discordAvatar: userData.discordAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      discordTag: userData.discordTag || 'Guest',
      currentRoom: 'global'
    });
    socket.join('global');
    io.to('global').emit('user_joined', { socketId: socket.id, user: connectedUsers.get(socket.id) });
  });

  socket.on('send_room_message', async (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const sanitizedMessage = await filterMessage(data.message);

    const payload = {
      senderSocketId: socket.id,
      gdUsername: user.gdUsername,
      discordId: user.discordId,
      discordAvatar: user.discordAvatar,
      discordTag: user.discordTag,
      message: sanitizedMessage,
      timestamp: new Date().toISOString()
    };

    const targetRoom = data.room || 'global';
    io.to(targetRoom).emit('receive_room_message', payload);
  });


  socket.on('send_private_message', async (data) => {
    const sender = connectedUsers.get(socket.id);
    if (!sender) return;

    const sanitizedMessage = await filterMessage(data.message);

    const payload = {
      senderSocketId: socket.id,
      gdUsername: sender.gdUsername,
      discordId: sender.discordId,
      discordAvatar: sender.discordAvatar,
      discordTag: sender.discordTag,
      message: sanitizedMessage,
      isPrivate: true,
      timestamp: new Date().toISOString()
    };

    io.to(data.recipientSocketId).emit('receive_private_message', payload);
    socket.emit('receive_private_message', payload); // Echo back to sender
  });

  socket.on('join_room', (roomName) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    socket.leave(user.currentRoom);
    socket.join(roomName);
    user.currentRoom = roomName;
    socket.emit('room_changed', { room: roomName });
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    io.emit('user_left', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Geode Chat Server listening on port ${PORT}`));
