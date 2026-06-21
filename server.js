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
const ASSIGNMENT_ORDER = ['Red', 'Yellow', 'Green', 'Blue']; // Prioritizes opposite corners for 2 players

const BOARD_PATH = [
    [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0]
];

const START_INDEX = { 'Red': 1, 'Green': 14, 'Yellow': 27, 'Blue': 40 };

function generateShortCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed easily confused characters
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createNewGame(hostId) {
    return {
        host: hostId,
        isStarted: false,
        players: {}, 
        colorsTaken: [],
        currentTurn: 'Red', // Will default to host's color upon start
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

    socket.on('createRoom', () => {
        let roomCode;
        do {
            roomCode = generateShortCode();
        } while (rooms[roomCode]); // Ensure unique code
        
        rooms[roomCode] = createNewGame(socket.id);
        joinRoomLogic(socket, roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        roomCode = roomCode.toUpperCase();
        if (!rooms[roomCode]) {
            socket.emit('errorMsg', 'Room not found! Check the code.');
            return;
        }
        if (rooms[roomCode].isStarted) {
            socket.emit('errorMsg', 'Game has already started in this room!');
            return;
        }
        joinRoomLogic(socket, roomCode);
    });

    function joinRoomLogic(socket, roomCode) {
        const game = rooms[roomCode];
        
        let assignedColor = ASSIGNMENT_ORDER.find(c => !game.colorsTaken.includes(c));
        
        if (!assignedColor) {
            socket.emit('errorMsg', 'Room is Full (Max 4 Players)!');
            return;
        }

        socket.join(roomCode);
        game.colorsTaken.push(assignedColor);
        game.players[socket.id] = { color: assignedColor, id: socket.id };

        socket.to(roomCode).emit('userJoinedVoice', { signalOriginId: socket.id, color: assignedColor });
        socket.emit('playerAssigned', { color: assignedColor, roomCode, isHost: game.host === socket.id });
        io.to(roomCode).emit('lobbyUpdate', { players: Object.values(game.players), roomCode, isHost: game.host === socket.id });
    }

    socket.on('startGame', (roomCode) => {
        const game = rooms[roomCode];
        if (game && game.host === socket.id && Object.keys(game.players).length >= 2) {
            game.isStarted = true;
            game.currentTurn = game.players[game.host].color; // Host goes first
            io.to(roomCode).emit('gameStarted', game);
            io.to(roomCode).emit('gameStateUpdate', game);
        }
    });

    socket.on('voiceOffer', ({ targetId, sdp }) => io.to(targetId).emit('voiceOffer', { senderId: socket.id, sdp }));
    socket.on('voiceAnswer', ({ targetId, sdp }) => io.to(targetId).emit('voiceAnswer', { senderId: socket.id, sdp }));
    socket.on('iceCandidate', ({ targetId, candidate }) => io.to(targetId).emit('iceCandidate', { senderId: socket.id, candidate }));

    socket.on('rollDice', (roomCode) => {
        const game = rooms[roomCode];
        if (!game || !game.isStarted || game.hasRolled) return;
        
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
        if (!game || !game.isStarted || !game.hasRolled) return;

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
            if (roll === 6 || isKnockout) {
                game.hasRolled = false; 
                game.diceRoll = null;
            } else {
                nextTurn(game);
            }
            io.to(roomCode).emit('gameStateUpdate', game);
        }, 1000);
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const game = rooms[roomCode];
            if (game.players[socket.id]) {
                const disconnectedColor = game.players[socket.id].color;
                
                game.colorsTaken = game.colorsTaken.filter(c => c !== disconnectedColor);
                delete game.players[socket.id];
                
                io.to(roomCode).emit('voiceUserLeft', socket.id);

                if (!game.isStarted) {
                    io.to(roomCode).emit('lobbyUpdate', { players: Object.values(game.players), roomCode, isHost: game.host === socket.id });
                } else {
                    if (game.currentTurn === disconnectedColor && Object.keys(game.players).length > 0) {
                        nextTurn(game);
                    }
                    io.to(roomCode).emit('gameStateUpdate', game);
                }
                
                if (Object.keys(game.players).length === 0) {
                    delete rooms[roomCode];
                } else if (game.host === socket.id) {
                    game.host = Object.keys(game.players)[0]; // Assign new host if original leaves
                }
                break;
            }
        }
    });
});

function nextTurn(game) {
    game.hasRolled = false;
    game.diceRoll = null;
    
    const activeColors = Object.values(game.players).map(p => p.color);
    if (activeColors.length === 0) return;

    let nextIdx = COLORS.indexOf(game.currentTurn);
    let loops = 0;
    
    do {
        nextIdx = (nextIdx + 1) % 4;
        loops++;
    } while (!activeColors.includes(COLORS[nextIdx]) && loops < 4);
    
    game.currentTurn = COLORS[nextIdx];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Multisession Ludo running on port ${PORT}`));
