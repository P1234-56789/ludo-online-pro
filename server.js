const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = generateCode();
        rooms[roomCode] = { host: socket.id, players: [{id: socket.id, color: 'Red'}] };
        socket.join(roomCode);
        socket.emit('playerAssigned', { roomCode, color: 'Red' });
    });

    socket.on('joinRoom', (code) => {
        const room = rooms[code.toUpperCase()];
        if (room) {
            socket.join(code.toUpperCase());
            room.players.push({id: socket.id, color: 'Yellow'});
            socket.emit('playerAssigned', { roomCode: code.toUpperCase(), color: 'Yellow' });
            io.to(code.toUpperCase()).emit('lobbyUpdate', room.players);
        } else {
            socket.emit('errorMsg', 'Room not found!');
        }
    });
});

server.listen(process.env.PORT || 3000);