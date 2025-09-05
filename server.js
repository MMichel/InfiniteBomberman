const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Game state
const gameState = {
    players: {},
    bombs: {},
    explosions: {},
    walls: {},
    gameStarted: false
};

// Game constants
const CELL_SIZE = 32;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const COLS = Math.floor(CANVAS_WIDTH / CELL_SIZE);
const ROWS = Math.floor(CANVAS_HEIGHT / CELL_SIZE);

// Serve static files
app.use(express.static(__dirname));

// Initialize walls
function initializeWalls() {
    gameState.walls = {};
    
    // Create border walls
    for (let x = 0; x < COLS; x++) {
        gameState.walls[`${x},0`] = { x, y: 0, destructible: false };
        gameState.walls[`${x},${ROWS-1}`] = { x, y: ROWS-1, destructible: false };
    }
    
    for (let y = 0; y < ROWS; y++) {
        gameState.walls[`0,${y}`] = { x: 0, y, destructible: false };
        gameState.walls[`${COLS-1},${y}`] = { x: COLS-1, y, destructible: false };
    }
    
    // Create some fixed walls
    for (let x = 2; x < COLS - 2; x += 2) {
        for (let y = 2; y < ROWS - 2; y += 2) {
            gameState.walls[`${x},${y}`] = { x, y, destructible: false };
        }
    }
    
    // Add random destructible walls
    for (let i = 0; i < 50; i++) {
        const x = Math.floor(Math.random() * (COLS - 4)) + 2;
        const y = Math.floor(Math.random() * (ROWS - 4)) + 2;
        const key = `${x},${y}`;
        
        // Don't place walls in starting positions
        if (!gameState.walls[key] && !(x <= 2 && y <= 2) && !(x >= COLS-3 && y <= 2) && 
            !(x <= 2 && y >= ROWS-3) && !(x >= COLS-3 && y >= ROWS-3)) {
            gameState.walls[key] = { x, y, destructible: true };
        }
    }
}

// Get spawn position for new player
function getSpawnPosition() {
    const positions = [
        { x: 1, y: 1 },
        { x: COLS - 2, y: 1 },
        { x: 1, y: ROWS - 2 },
        { x: COLS - 2, y: ROWS - 2 }
    ];
    
    // Return first available position
    for (const pos of positions) {
        const key = `${pos.x},${pos.y}`;
        const occupied = Object.values(gameState.players).some(p => p.x === pos.x && p.y === pos.y);
        if (!occupied && !gameState.walls[key]) {
            return pos;
        }
    }
    
    // Fallback to random position
    return { x: 1, y: 1 };
}

// Check if position is valid (no walls, bombs, or out of bounds)
function isValidPosition(x, y) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    const key = `${x},${y}`;
    return !gameState.walls[key] && !gameState.bombs[key];
}

// Place bomb
function placeBomb(playerId, x, y) {
    const bombKey = `${x},${y}`;
    if (gameState.bombs[bombKey]) return false;
    
    gameState.bombs[bombKey] = {
        id: `bomb_${Date.now()}_${Math.random()}`,
        x: x,
        y: y,
        timer: 3000,
        range: 3,
        playerId: playerId
    };
    
    // Set timer for explosion
    setTimeout(() => {
        explodeBomb(gameState.bombs[bombKey]);
        delete gameState.bombs[bombKey];
        broadcastGameState();
    }, 3000);
    
    return true;
}

// Explode bomb
function explodeBomb(bomb) {
    if (!bomb) return;
    
    const explosionPositions = [];
    
    // Create explosion at bomb position
    const centerPos = `${bomb.x},${bomb.y}`;
    explosionPositions.push(centerPos);
    gameState.explosions[centerPos] = {
        x: bomb.x,
        y: bomb.y,
        createdAt: Date.now()
    };
    
    // Create explosions in 4 directions
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    
    directions.forEach(([dx, dy]) => {
        for (let i = 1; i <= bomb.range; i++) {
            const x = bomb.x + dx * i;
            const y = bomb.y + dy * i;
            const wallKey = `${x},${y}`;
            
            // Stop if out of bounds
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS) break;
            
            // Stop if hit indestructible wall
            if (gameState.walls[wallKey] && !gameState.walls[wallKey].destructible) {
                break;
            }
            
            // Create explosion
            explosionPositions.push(wallKey);
            gameState.explosions[wallKey] = {
                x: x,
                y: y,
                createdAt: Date.now()
            };
            
            // Destroy destructible wall and stop
            if (gameState.walls[wallKey] && gameState.walls[wallKey].destructible) {
                delete gameState.walls[wallKey];
                break;
            }
        }
    });
    
    // Remove these specific explosions after timer
    setTimeout(() => {
        explosionPositions.forEach(pos => {
            delete gameState.explosions[pos];
        });
        broadcastGameState();
    }, 500);
}

// Broadcast game state to all clients
function broadcastGameState() {
    io.emit('gameState', {
        players: gameState.players,
        bombs: gameState.bombs,
        explosions: gameState.explosions,
        walls: gameState.walls
    });
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Initialize walls if first player
    if (Object.keys(gameState.players).length === 0) {
        initializeWalls();
    }
    
    // Add new player
    const spawnPos = getSpawnPosition();
    const playerColors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44'];
    const playerCount = Object.keys(gameState.players).length;
    
    gameState.players[socket.id] = {
        id: socket.id,
        x: spawnPos.x,
        y: spawnPos.y,
        color: playerColors[playerCount % playerColors.length],
        alive: true
    };
    
    // Send initial game state to new player
    socket.emit('init', {
        playerId: socket.id,
        gameState: {
            players: gameState.players,
            bombs: gameState.bombs,
            explosions: gameState.explosions,
            walls: gameState.walls
        }
    });
    
    // Broadcast updated game state to all players
    broadcastGameState();
    
    // Handle player movement
    socket.on('move', (data) => {
        const player = gameState.players[socket.id];
        if (!player || !player.alive) return;
        
        const { x, y } = data;
        if (isValidPosition(x, y)) {
            player.x = x;
            player.y = y;
            broadcastGameState();
        }
    });
    
    // Handle bomb placement
    socket.on('placeBomb', (data) => {
        const player = gameState.players[socket.id];
        if (!player || !player.alive) return;
        
        const { x, y } = data;
        if (placeBomb(socket.id, x, y)) {
            broadcastGameState();
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete gameState.players[socket.id];
        broadcastGameState();
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});