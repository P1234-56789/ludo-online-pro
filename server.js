const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
const rooms = {};
const COLORS = ['Red', 'Green', 'Yellow', 'Blue'];
const ASSIGNMENT_ORDER = ['Red', 'Yellow', 'Green', 'Blue'];

function generateShortCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length: 5}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function createNewGame(hostId) {
    return {
        host: hostId, isStarted: false, players: {}, colorsTaken: [], currentTurn: 'Red',
        diceRoll: null, hasRolled: false,
        tokens: { 'Red': [-1,-1,-1,-1], 'Green': [-1,-1,-1,-1], 'Yellow': [-1,-1,-1,-1], 'Blue': [-1,-1,-1,-1] }
    };
}

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        let roomCode = generateShortCode();
        rooms[roomCode] = createNewGame(socket.id);
        joinRoomLogic(socket, roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        roomCode = roomCode.toUpperCase();
        if (!rooms[roomCode]) return socket.emit('errorMsg', 'Invalid Room Code');
        if (rooms[roomCode].isStarted) return socket.emit('errorMsg', 'Game already started');
        joinRoomLogic(socket, roomCode);
    });

    function joinRoomLogic(socket, roomCode) {
        const game = rooms[roomCode];
        let color = ASSIGNMENT_ORDER.find(c => !game.colorsTaken.includes(c));
        if (!color) return socket.emit('errorMsg', 'Room Full');
        socket.join(roomCode);
        game.colorsTaken.push(color);
        game.players[socket.id] = { color, id: socket.id };
        socket.emit('playerAssigned', { color, roomCode });
        io.to(roomCode).emit('lobbyUpdate', { players: Object.values(game.players), hostColor: game.players[game.host].color });
    }

    socket.on('startGame', (roomCode) => {
        const game = rooms[roomCode];
        if (game && game.host === socket.id && Object.keys(game.players).length >= 2) {
            game.isStarted = true; game.currentTurn = game.players[game.host].color;
            io.to(roomCode).emit('gameStarted', game);
        }
    });

    socket.on('moveToken', ({ roomCode, tokenIndex }) => {
        const game = rooms[roomCode];
        if (!game || !game.hasRolled) return;
        const player = game.players[socket.id];
        if (!player || player.color !== game.currentTurn) return;

        let pos = game.tokens[player.color][tokenIndex];
        let roll = game.diceRoll;
        
        if ((pos === -1 && roll === 6) || (pos >= 0 && pos + roll <= 57)) {
            game.tokens[player.color][tokenIndex] = pos === -1 ? 0 : pos + roll;
            io.to(roomCode).emit('tokenMoved', { game, color: player.color });
            
            setTimeout(() => {
                if (roll !== 6) { 
                    let colors = Object.values(game.players).map(p => p.color);
                    let idx = COLORS.indexOf(game.currentTurn);
                    do { idx = (idx + 1) % 4; } while (!colors.includes(COLORS[idx]));
                    game.currentTurn = COLORS[idx];
                }
                game.hasRolled = false; game.diceRoll = null;
                io.to(roomCode).emit('gameStateUpdate', game);
            }, 1000);
        }
    });

    // Signaling for WebRTC remains identical
    socket.on('voiceOffer', (d) => io.to(d.targetId).emit('voiceOffer', { senderId: socket.id, sdp: d.sdp }));
    socket.on('voiceAnswer', (d) => io.to(d.targetId).emit('voiceAnswer', { senderId: socket.id, sdp: d.sdp }));
    socket.on('iceCandidate', (d) => io.to(d.targetId).emit('iceCandidate', { senderId: socket.id, candidate: d.candidate }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Inside server.js
socket.on('createRoom', () => {
    let roomCode = generateShortCode();
    rooms[roomCode] = createNewGame(socket.id);
    
    // Explicitly send the room code to the host
    socket.join(roomCode);
    socket.emit('playerAssigned', { 
        color: 'Red', 
        roomCode: roomCode, 
        isHost: true 
    });
});
