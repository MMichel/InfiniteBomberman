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
    players: {}, // keyed by persistent player ID
    bombs: {},
    explosions: {},
    walls: {},
    gameStarted: false
};

// Map socket IDs to persistent player IDs
const socketToPlayer = {};

// Game constants
const CELL_SIZE = 32;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const COLS = Math.floor(CANVAS_WIDTH / CELL_SIZE);
const ROWS = Math.floor(CANVAS_HEIGHT / CELL_SIZE) + 1; // Add 1 to fill unused space

// Serve static files
app.use(express.static(__dirname));

// Initialize walls
function initializeWalls() {
    gameState.walls = {};
    
    // No border walls for wrap-around world!
    
    // Create some fixed walls (avoid edges since they're now open)
    for (let x = 1; x < COLS - 1; x += 2) {
        for (let y = 1; y < ROWS - 1; y += 2) {
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

// Wrap coordinate to handle world wrap-around
function wrapCoordinate(value, max) {
    while (value < 0) value += max;
    while (value >= max) value -= max;
    return value;
}

// Get spawn position for new player (avoid edges for cleaner spawning)
function getSpawnPosition() {
    const positions = [
        { x: 2, y: 2 },
        { x: COLS - 3, y: 2 },
        { x: 2, y: ROWS - 3 },
        { x: COLS - 3, y: ROWS - 3 }
    ];
    
    // Return first available position
    for (const pos of positions) {
        const key = `${pos.x},${pos.y}`;
        const occupied = Object.values(gameState.players).some(p => p.x === pos.x && p.y === pos.y);
        if (!occupied && !gameState.walls[key]) {
            return pos;
        }
    }
    
    // Fallback to center position
    return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
}

// Check if position is valid (no walls, bombs) - wrap-around world has no bounds
function isValidPosition(x, y) {
    // Wrap coordinates
    const wrappedX = wrapCoordinate(x, COLS);
    const wrappedY = wrapCoordinate(y, ROWS);
    const key = `${wrappedX},${wrappedY}`;
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
        console.log(`\nBomb at (${bomb.x}, ${bomb.y}) exploding in direction (${dx}, ${dy})`);
        let stopped = false;
        
        for (let i = 1; i <= bomb.range; i++) {
            if (stopped) break;
            
            const x = bomb.x + dx * i;
            const y = bomb.y + dy * i;
            
            // Apply wrap-around to explosion coordinates
            const wrappedX = wrapCoordinate(x, COLS);
            const wrappedY = wrapCoordinate(y, ROWS);
            const wallKey = `${wrappedX},${wrappedY}`;
            
            console.log(`  Range ${i}: (${x}, ${y}) -> wrapped (${wrappedX}, ${wrappedY})`);
            
            // Create explosion at wrapped position (always create, regardless of obstacles)
            explosionPositions.push(wallKey);
            gameState.explosions[wallKey] = {
                x: wrappedX,
                y: wrappedY,
                createdAt: Date.now()
            };
            
            // Check for walls after creating explosion
            if (gameState.walls[wallKey]) {
                console.log(`    Hit wall at (${wrappedX}, ${wrappedY}) - destructible: ${gameState.walls[wallKey].destructible}`);
                if (gameState.walls[wallKey].destructible) {
                    // Destroy destructible wall and stop further explosions in this direction
                    delete gameState.walls[wallKey];
                }
                // Stop explosion in this direction (but explosion was already created at this position)
                stopped = true;
            }
        }
    });
    
    // Check for player deaths from explosions
    checkPlayerExplosionCollisions(explosionPositions);
    
    // Remove these specific explosions after timer
    setTimeout(() => {
        explosionPositions.forEach(pos => {
            delete gameState.explosions[pos];
        });
        broadcastGameState();
    }, 500);
}

// Check for player deaths from explosions
function checkPlayerExplosionCollisions(explosionPositions) {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;
        
        const playerPos = `${player.x},${player.y}`;
        if (explosionPositions.includes(playerPos)) {
            // Player hit by explosion
            player.lives--;
            
            if (player.lives > 0) {
                // Respawn player
                const spawnPos = getSpawnPosition();
                player.x = spawnPos.x;
                player.y = spawnPos.y;
                player.alive = true;
            } else {
                // Player eliminated
                player.alive = false;
            }
        }
    });
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
    
    // Handle persistent player ID setup
    socket.on('setPlayerId', (data) => {
        const { persistentId } = data;
        socketToPlayer[socket.id] = persistentId;
        
        // Check if player already exists (reconnection)
        if (!gameState.players[persistentId]) {
            // Add new player
            const spawnPos = getSpawnPosition();
            const playerColors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44'];
            const playerCount = Object.keys(gameState.players).length; // Count BEFORE adding new player
            
            gameState.players[persistentId] = {
                id: persistentId,
                x: spawnPos.x,
                y: spawnPos.y,
                color: playerColors[playerCount % playerColors.length],
                alive: true,
                lives: 5
            };
            
            console.log(`New player ${persistentId} created with color ${playerColors[playerCount % playerColors.length]} at position (${spawnPos.x}, ${spawnPos.y})`);
        } else {
            console.log(`Existing player ${persistentId} reconnected with ${gameState.players[persistentId].lives} lives`);
        }
        
        // Send initial game state to player
        socket.emit('init', {
            playerId: persistentId,
            gameState: {
                players: gameState.players,
                bombs: gameState.bombs,
                explosions: gameState.explosions,
                walls: gameState.walls
            }
        });
        
        // Broadcast updated game state to all players
        broadcastGameState();
    });
    
    // Handle player movement
    socket.on('move', (data) => {
        const persistentId = socketToPlayer[socket.id];
        if (!persistentId) return;
        
        const player = gameState.players[persistentId];
        if (!player || !player.alive) return;
        
        const { x, y } = data;
        // Apply wrap-around to coordinates
        const wrappedX = wrapCoordinate(x, COLS);
        const wrappedY = wrapCoordinate(y, ROWS);
        
        if (isValidPosition(x, y)) {
            player.x = wrappedX;
            player.y = wrappedY;
            broadcastGameState();
        }
    });
    
    // Handle bomb placement
    socket.on('placeBomb', (data) => {
        const persistentId = socketToPlayer[socket.id];
        if (!persistentId) return;
        
        const player = gameState.players[persistentId];
        if (!player || !player.alive) return;
        
        const { x, y } = data;
        if (placeBomb(persistentId, x, y)) {
            broadcastGameState();
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        // Don't delete player data on disconnect - keep it for reconnection
        delete socketToPlayer[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});