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

const BOARD_PATH = [
    [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0]
];

const START_INDEX = { 'Red': 1, 'Green': 14, 'Yellow': 27, 'Blue': 40 };

function createNewGame() {
    return {
        players: {}, 
        colorsTaken: [],
        currentTurn: 'Red',
        diceRoll: null,
        hasRolled: false,
        tokens: {
            'Red':    [-1, -1, -1, -1],
            'Green':  [-1, -1, -1, -1],
            'Yellow': [-1, -1, -1, -1],
            'Blue':   [-1, -1, -1, -1]
        }
    };
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = createNewGame();
        }
        
        const game = rooms[roomCode];
        let player = game.players[socket.id];
        let assignedColor = player ? player.color : null;

        if (!assignedColor) {
            assignedColor = COLORS.find(c => !game.colorsTaken.includes(c));
            if (!assignedColor) {
                socket.emit('errorMsg', 'Room is Full!');
                return;
            }
            game.colorsTaken.push(assignedColor);
            game.players[socket.id] = { color: assignedColor, id: socket.id };
        }
        
        socket.to(roomCode).emit('userJoinedVoice', { signalOriginId: socket.id, color: assignedColor });
        socket.emit('playerAssigned', { color: assignedColor, roomCode });
        io.to(roomCode).emit('gameStateUpdate', game);
    });

    socket.on('voiceOffer', ({ targetId, sdp }) => {
        io.to(targetId).emit('voiceOffer', { senderId: socket.id, sdp });
    });

    socket.on('voiceAnswer', ({ targetId, sdp }) => {
        io.to(targetId).emit('voiceAnswer', { senderId: socket.id, sdp });
    });

    socket.on('iceCandidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('iceCandidate', { senderId: socket.id, candidate });
    });

    socket.on('rollDice', (roomCode) => {
        const game = rooms[roomCode];
        if (!game || game.hasRolled) return;
        
        const player = game.players[socket.id];
        if (!player || player.color !== game.currentTurn) return;

        game.diceRoll = Math.floor(Math.random() * 6) + 1;
        game.hasRolled = true;

        io.to(roomCode).emit('diceRolled', { roll: game.diceRoll, game });

        const activeTokens = game.tokens[game.currentTurn];
        const canMove = activeTokens.some(pos => {
            if (pos === -1 && game.diceRoll === 6) return true;
            if (pos >= 0 && pos + game.diceRoll <= 57) return true;
            return false;
        });
        
        if (!canMove) {
            setTimeout(() => {
                nextTurn(game);
                io.to(roomCode).emit('gameStateUpdate', game);
            }, 1800);
        }
    });

    socket.on('moveToken', ({ roomCode, tokenIndex }) => {
        const game = rooms[roomCode];
        if (!game || !game.hasRolled) return;

        const player = game.players[socket.id];
        if (!player || player.color !== game.currentTurn) return;

        let currentPos = game.tokens[player.color][tokenIndex];
        const roll = game.diceRoll;
        let targetPos = currentPos;
        let isKnockout = false;

        if (currentPos === -1 && roll === 6) {
            targetPos = 0; 
        } else if (currentPos >= 0 && currentPos + roll <= 57) {
            targetPos += roll;
        } else {
            return;
        }

        game.tokens[player.color][tokenIndex] = targetPos;

        if (targetPos >= 0 && targetPos < 51) {
            const movedGlobalPos = (START_INDEX[player.color] + targetPos) % 52;
            COLORS.forEach(color => {
                if (color === player.color) return;
                game.tokens[color].forEach((pos, idx) => {
                    if (pos >= 0 && pos < 51) {
                        const oppGlobalPos = (START_INDEX[color] + pos) % 52;
                        if (movedGlobalPos === oppGlobalPos) {
                            game.tokens[color][idx] = -1;
                            isKnockout = true;
                        }
                    }
                });
            });
        }

        io.to(roomCode).emit('tokenMoved', { game, movingColor: player.color, tokenIndex, oldPos: currentPos, newPos: targetPos, isKnockout });

        setTimeout(() => {
            nextTurn(game);
            io.to(roomCode).emit('gameStateUpdate', game);
        }, 1000);
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            if (game.players[socket.id]) {
                const color = game.players[socket.id].color;
                game.colorsTaken = game.colorsTaken.filter(c => c !== color);
                delete game.players[socket.id];
                io.to(roomCode).emit('voiceUserLeft', socket.id);
                io.to(roomCode).emit('gameStateUpdate', game);
                if (Object.keys(game.players).length === 0) {
                    delete rooms[roomCode];
                }
                break;
            }
        }
    });
});

function nextTurn(game) {
    game.hasRolled = false;
    game.diceRoll = null;
    let nextIdx = (COLORS.indexOf(game.currentTurn) + 1) % 4;
    game.currentTurn = COLORS[nextIdx];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Production Ludo running on port ${PORT}`));
