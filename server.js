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
    powerups: {}, // keyed by "x,y" position
    fireTrails: {}, // keyed by "x,y" position
    gameStarted: false
};

// Map socket IDs to persistent player IDs
const socketToPlayer = {};

// Power-up definitions (easily extensible)
const POWERUPS = {
    MEGA_BOMB: {
        id: 'mega_bomb',
        name: 'Mega Bomb',
        emoji: '💥',
        color: '#FF6B35',
        spawnChance: 0.3, // 30% chance when wall destroyed
        duration: 0, // One-time use
        description: 'Next bomb has double range'
    },
    TORNADO_BOMB: {
        id: 'tornado_bomb', 
        name: 'Tornado Bomb',
        emoji: '🌪️',
        color: '#4ECDC4',
        spawnChance: 0.25, // 25% chance
        duration: 0, // One-time use
        description: 'Next bomb explodes in spiral pattern'
    },
    FIRE_TRAIL: {
        id: 'fire_trail',
        name: 'Fire Trail',
        emoji: '🔥',
        color: '#FF4757',
        spawnChance: 0.2, // 20% chance
        duration: 10000, // 10 seconds
        description: 'Leave burning trail behind you'
    },
    GHOST_MODE: {
        id: 'ghost_mode',
        name: 'Ghost Mode',
        emoji: '👻',
        color: '#E0E0E0',
        spawnChance: 0.15,
        duration: 10000, // 10 seconds
        description: 'Walk through walls'
    },
    TELEPORT: {
        id: 'teleport',
        name: 'Teleport',
        emoji: '🌀',
        color: '#9B59B6',
        spawnChance: 0.15,
        duration: 0, // One-time use
        description: 'Click anywhere to teleport'
    },
    EXTRA_LIFE: {
        id: 'extra_life',
        name: 'Extra Life',
        emoji: '💖',
        color: '#E74C3C',
        spawnChance: 0.1,
        duration: 0, // Instant effect
        description: 'Gain +1 life (max 8)'
    },
    FORCE_FIELD: {
        id: 'force_field',
        name: 'Force Field',
        emoji: '🛡️',
        color: '#3498DB',
        spawnChance: 0.12,
        duration: 8000, // 8 seconds
        description: 'Immune to explosions'
    },
    SWAP: {
        id: 'swap',
        name: 'Swap',
        emoji: '🔄',
        color: '#F39C12',
        spawnChance: 0.08,
        duration: 0, // One-time use
        description: 'Switch positions with random player'
    },
    SCRAMBLE: {
        id: 'scramble',
        name: 'Scramble',
        emoji: '🎲',
        color: '#8E44AD',
        spawnChance: 0.05,
        duration: 0, // One-time use
        description: 'Randomize all players positions'
    },
    MAGNET: {
        id: 'magnet',
        name: 'Magnet',
        emoji: '🧲',
        color: '#E67E22',
        spawnChance: 0.12,
        duration: 5000, // 5 seconds
        description: 'Pull all nearby items to you'
    },
    WALL_BUILDER: {
        id: 'wall_builder',
        name: 'Wall Builder',
        emoji: '🧱',
        color: '#95A5A6',
        spawnChance: 0.1,
        duration: 0, // One-time use, but provides 3 uses
        description: 'Place 3 destructible walls anywhere'
    }
};

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
    for (let i = 0; i < 120; i++) {
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

// Power-up system functions
function spawnPowerup(x, y) {
    const powerupTypes = Object.values(POWERUPS);
    
    // Always spawn a power-up - randomly select which one
    const randomPowerup = powerupTypes[Math.floor(Math.random() * powerupTypes.length)];
    const key = `${x},${y}`;
    gameState.powerups[key] = {
        x: x,
        y: y,
        type: randomPowerup.id,
        createdAt: Date.now()
    };
    console.log(`Spawned ${randomPowerup.name} at (${x}, ${y})`);
}

function collectPowerup(playerId, x, y) {
    const key = `${x},${y}`;
    const powerup = gameState.powerups[key];
    if (!powerup) return false;
    
    const player = gameState.players[playerId];
    if (!player) return false;
    
    // Initialize player powerups if not exists
    if (!player.powerups) player.powerups = {};
    
    const powerupDef = Object.values(POWERUPS).find(p => p.id === powerup.type);
    if (!powerupDef) return false;
    
    // Handle instant-effect power-ups immediately
    if (powerup.type === 'extra_life') {
        player.lives = Math.min(player.lives + 1, 8);
        console.log(`Player ${playerId} gained extra life (now ${player.lives} lives)`);
    } else if (powerup.type === 'swap') {
        // Find another alive player to swap with
        const alivePlayers = Object.keys(gameState.players).filter(id => 
            id !== playerId && gameState.players[id].alive);
        if (alivePlayers.length > 0) {
            const targetId = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            const target = gameState.players[targetId];
            const tempX = player.x, tempY = player.y;
            player.x = target.x;
            player.y = target.y;
            target.x = tempX;
            target.y = tempY;
            console.log(`Player ${playerId} swapped positions with ${targetId}`);
        }
    } else if (powerup.type === 'scramble') {
        // Randomize all alive players' positions
        const alivePlayers = Object.values(gameState.players).filter(p => p.alive);
        alivePlayers.forEach(p => {
            let attempts = 0;
            let newX, newY;
            do {
                newX = Math.floor(Math.random() * COLS);
                newY = Math.floor(Math.random() * ROWS);
                attempts++;
            } while (attempts < 20 && gameState.walls[`${newX},${newY}`]);
            p.x = newX;
            p.y = newY;
        });
        console.log(`Player ${playerId} scrambled all player positions`);
    } else if (powerupDef.duration > 0) {
        // Timed power-up
        player.powerups[powerup.type] = {
            expiresAt: Date.now() + powerupDef.duration,
            active: true
        };
    } else {
        // One-time use power-up (teleport, wall_builder)
        player.powerups[powerup.type] = {
            uses: (player.powerups[powerup.type]?.uses || 0) + 1,
            active: true
        };
        // Special handling for wall_builder
        if (powerup.type === 'wall_builder') {
            player.powerups[powerup.type].uses = 3; // Override to give 3 uses
        }
    }
    
    delete gameState.powerups[key];
    console.log(`Player ${playerId} collected ${powerupDef.name}`);
    return true;
}

function updatePlayerPowerups(playerId) {
    const player = gameState.players[playerId];
    if (!player || !player.powerups) return;
    
    const now = Date.now();
    Object.keys(player.powerups).forEach(powerupId => {
        const powerup = player.powerups[powerupId];
        
        // Remove expired timed power-ups
        if (powerup.expiresAt && now > powerup.expiresAt) {
            delete player.powerups[powerupId];
            console.log(`Player ${playerId} lost ${powerupId} (expired)`);
        }
    });
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
    
    const player = gameState.players[playerId];
    if (!player) return false;
    
    // Determine bomb properties based on player power-ups
    let bombRange = 3;
    let bombType = 'normal';
    
    // Check for Mega Bomb power-up
    if (player.powerups?.mega_bomb?.uses > 0) {
        bombRange = 6; // Double range
        bombType = 'mega';
        player.powerups.mega_bomb.uses--;
        if (player.powerups.mega_bomb.uses <= 0) {
            delete player.powerups.mega_bomb;
        }
        console.log(`Player ${playerId} used Mega Bomb (${bombRange} range)`);
    }
    // Check for Tornado Bomb power-up
    else if (player.powerups?.tornado_bomb?.uses > 0) {
        bombType = 'tornado';
        player.powerups.tornado_bomb.uses--;
        if (player.powerups.tornado_bomb.uses <= 0) {
            delete player.powerups.tornado_bomb;
        }
        console.log(`Player ${playerId} used Tornado Bomb`);
    }
    
    gameState.bombs[bombKey] = {
        id: `bomb_${Date.now()}_${Math.random()}`,
        x: x,
        y: y,
        timer: 3000,
        range: bombRange,
        type: bombType,
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
    
    console.log(`Exploding ${bomb.type} bomb at (${bomb.x}, ${bomb.y}) with range ${bomb.range}`);
    
    let explosionPositions = [];
    
    // Create explosion at bomb position
    const centerPos = `${bomb.x},${bomb.y}`;
    explosionPositions.push(centerPos);
    gameState.explosions[centerPos] = {
        x: bomb.x,
        y: bomb.y,
        createdAt: Date.now()
    };
    
    // Different explosion patterns based on bomb type
    if (bomb.type === 'tornado') {
        explosionPositions = explosionPositions.concat(createTornadoExplosion(bomb));
    } else {
        explosionPositions = explosionPositions.concat(createNormalExplosion(bomb));
    }
    
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

function createNormalExplosion(bomb) {
    const explosionPositions = [];
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    
    directions.forEach(([dx, dy]) => {
        let stopped = false;
        
        for (let i = 1; i <= bomb.range; i++) {
            if (stopped) break;
            
            const x = bomb.x + dx * i;
            const y = bomb.y + dy * i;
            
            // Apply wrap-around to explosion coordinates
            const wrappedX = wrapCoordinate(x, COLS);
            const wrappedY = wrapCoordinate(y, ROWS);
            const wallKey = `${wrappedX},${wrappedY}`;
            
            // Create explosion at wrapped position
            explosionPositions.push(wallKey);
            gameState.explosions[wallKey] = {
                x: wrappedX,
                y: wrappedY,
                createdAt: Date.now()
            };
            
            // Check for walls after creating explosion
            if (gameState.walls[wallKey]) {
                if (gameState.walls[wallKey].destructible) {
                    delete gameState.walls[wallKey];
                    spawnPowerup(wrappedX, wrappedY);
                }
                stopped = true;
            }
        }
    });
    
    return explosionPositions;
}

function createTornadoExplosion(bomb) {
    const explosionPositions = [];
    const spiralPattern = [
        // Ring 1 (adjacent)
        [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
        // Ring 2 (distance 2)
        [0, 2], [1, 2], [2, 1], [2, 0], [2, -1], [1, -2], [0, -2], [-1, -2], [-2, -1], [-2, 0], [-2, 1], [-1, 2],
        // Ring 3 (distance 3)
        [0, 3], [1, 3], [2, 3], [3, 2], [3, 1], [3, 0], [3, -1], [3, -2], [2, -3], [1, -3], [0, -3], [-1, -3], [-2, -3], [-3, -2], [-3, -1], [-3, 0], [-3, 1], [-3, 2], [-2, 3], [-1, 3]
    ];
    
    spiralPattern.forEach(([dx, dy]) => {
        const x = bomb.x + dx;
        const y = bomb.y + dy;
        
        const wrappedX = wrapCoordinate(x, COLS);
        const wrappedY = wrapCoordinate(y, ROWS);
        const wallKey = `${wrappedX},${wrappedY}`;
        
        // Create explosion
        explosionPositions.push(wallKey);
        gameState.explosions[wallKey] = {
            x: wrappedX,
            y: wrappedY,
            createdAt: Date.now()
        };
        
        // Destroy walls
        if (gameState.walls[wallKey]?.destructible) {
            delete gameState.walls[wallKey];
            spawnPowerup(wrappedX, wrappedY);
        }
    });
    
    return explosionPositions;
}

// Check for player deaths from explosions
function checkPlayerExplosionCollisions(explosionPositions) {
    Object.values(gameState.players).forEach(player => {
        if (!player.alive) return;
        
        const playerPos = `${player.x},${player.y}`;
        if (explosionPositions.includes(playerPos)) {
            // Check if player has force field immunity
            if (player.powerups?.force_field?.active) {
                console.log(`Player ${player.id} protected by force field`);
                return; // Skip damage
            }
            
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
    // Update all player power-ups before broadcasting
    Object.keys(gameState.players).forEach(updatePlayerPowerups);
    
    io.emit('gameState', {
        players: gameState.players,
        bombs: gameState.bombs,
        explosions: gameState.explosions,
        walls: gameState.walls,
        powerups: gameState.powerups,
        fireTrails: gameState.fireTrails
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
        
        // Check if player can move to position (ghost mode bypasses wall checks)
        const hasGhostMode = player.powerups?.ghost_mode?.active;
        const canMove = hasGhostMode ? !gameState.bombs[`${wrappedX},${wrappedY}`] : isValidPosition(x, y);
        
        if (canMove) {
            // Leave fire trail if player has fire trail power-up
            if (player.powerups?.fire_trail?.active) {
                const oldPos = `${player.x},${player.y}`;
                gameState.fireTrails[oldPos] = {
                    x: player.x,
                    y: player.y,
                    createdAt: Date.now(),
                    playerId: persistentId
                };
                
                // Remove fire trail after 2 seconds
                setTimeout(() => {
                    delete gameState.fireTrails[oldPos];
                }, 2000);
            }
            
            player.x = wrappedX;
            player.y = wrappedY;
            
            // Handle magnet power-up effect
            if (player.powerups?.magnet?.active) {
                const magnetRange = 3;
                const powerupsToMove = [];
                
                // Find nearby power-ups within range
                Object.values(gameState.powerups).forEach(powerup => {
                    const dx = Math.abs(powerup.x - wrappedX);
                    const dy = Math.abs(powerup.y - wrappedY);
                    
                    // Handle wrap-around distance calculation
                    const wrappedDx = Math.min(dx, COLS - dx);
                    const wrappedDy = Math.min(dy, ROWS - dy);
                    
                    if (wrappedDx <= magnetRange && wrappedDy <= magnetRange) {
                        powerupsToMove.push(powerup);
                    }
                });
                
                // Move power-ups towards player
                powerupsToMove.forEach(powerup => {
                    const oldKey = `${powerup.x},${powerup.y}`;
                    
                    // Calculate direction to player
                    let newX = powerup.x;
                    let newY = powerup.y;
                    
                    if (powerup.x !== wrappedX) {
                        const dx = wrappedX - powerup.x;
                        const wrappedDx = dx > COLS/2 ? dx - COLS : dx < -COLS/2 ? dx + COLS : dx;
                        newX = wrapCoordinate(powerup.x + (wrappedDx > 0 ? 1 : -1), COLS);
                    }
                    
                    if (powerup.y !== wrappedY) {
                        const dy = wrappedY - powerup.y;
                        const wrappedDy = dy > ROWS/2 ? dy - ROWS : dy < -ROWS/2 ? dy + ROWS : dy;
                        newY = wrapCoordinate(powerup.y + (wrappedDy > 0 ? 1 : -1), ROWS);
                    }
                    
                    const newKey = `${newX},${newY}`;
                    
                    // Only move if new position is empty
                    if (!gameState.powerups[newKey] && !gameState.walls[newKey]) {
                        delete gameState.powerups[oldKey];
                        powerup.x = newX;
                        powerup.y = newY;
                        gameState.powerups[newKey] = powerup;
                    }
                });
            }
            
            // Check for power-up collection
            if (collectPowerup(persistentId, wrappedX, wrappedY)) {
                // Power-up collected, broadcast update
            }
            
            // Check if player stepped on fire trail
            const currentPos = `${wrappedX},${wrappedY}`;
            const fireTrail = gameState.fireTrails[currentPos];
            if (fireTrail && fireTrail.playerId !== persistentId) {
                // Player hit by fire trail - take damage
                checkPlayerExplosionCollisions([currentPos]);
            }
            
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
    
    // Handle teleport
    socket.on('teleport', (data) => {
        const persistentId = socketToPlayer[socket.id];
        if (!persistentId) return;
        
        const player = gameState.players[persistentId];
        if (!player || !player.alive) return;
        
        // Check if player has teleport power-up
        if (!player.powerups?.teleport?.uses || player.powerups.teleport.uses <= 0) return;
        
        const { x, y } = data;
        const wrappedX = wrapCoordinate(x, COLS);
        const wrappedY = wrapCoordinate(y, ROWS);
        
        // Don't allow teleporting into walls or bombs (unlike ghost mode)
        if (isValidPosition(x, y)) {
            player.x = wrappedX;
            player.y = wrappedY;
            
            // Use up one teleport
            player.powerups.teleport.uses--;
            if (player.powerups.teleport.uses <= 0) {
                delete player.powerups.teleport;
            }
            
            console.log(`Player ${persistentId} teleported to (${wrappedX}, ${wrappedY})`);
            broadcastGameState();
        }
    });
    
    // Handle wall building
    socket.on('buildWall', (data) => {
        const persistentId = socketToPlayer[socket.id];
        if (!persistentId) return;
        
        const player = gameState.players[persistentId];
        if (!player || !player.alive) return;
        
        // Check if player has wall builder power-up
        if (!player.powerups?.wall_builder?.uses || player.powerups.wall_builder.uses <= 0) return;
        
        const { x, y } = data;
        const wrappedX = wrapCoordinate(x, COLS);
        const wrappedY = wrapCoordinate(y, ROWS);
        const wallKey = `${wrappedX},${wrappedY}`;
        
        // Don't allow building on occupied positions
        const occupied = gameState.walls[wallKey] || 
                         gameState.bombs[wallKey] ||
                         gameState.powerups[wallKey] ||
                         Object.values(gameState.players).some(p => p.x === wrappedX && p.y === wrappedY);
        
        if (!occupied) {
            gameState.walls[wallKey] = { x: wrappedX, y: wrappedY, destructible: true };
            
            // Use up one wall build
            player.powerups.wall_builder.uses--;
            if (player.powerups.wall_builder.uses <= 0) {
                delete player.powerups.wall_builder;
            }
            
            console.log(`Player ${persistentId} built wall at (${wrappedX}, ${wrappedY})`);
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

// Random block spawning system
function spawnRandomBlock() {
    // Don't spawn if there are too many destructible walls already
    const currentWallCount = Object.values(gameState.walls).filter(wall => wall.destructible).length;
    if (currentWallCount >= 150) return;
    
    // Try to find an empty position
    for (let attempts = 0; attempts < 20; attempts++) {
        const x = Math.floor(Math.random() * (COLS - 4)) + 2;
        const y = Math.floor(Math.random() * (ROWS - 4)) + 2;
        const wallKey = `${x},${y}`;
        const powerupKey = `${x},${y}`;
        
        // Check if position is empty (no walls, bombs, players, or power-ups)
        const positionEmpty = !gameState.walls[wallKey] && 
                             !gameState.powerups[powerupKey] &&
                             !Object.values(gameState.bombs).some(bomb => bomb.x === x && bomb.y === y) &&
                             !Object.values(gameState.players).some(player => player.x === x && player.y === y);
        
        // Don't spawn too close to starting positions
        const tooCloseToStart = (x <= 2 && y <= 2) || (x >= COLS-3 && y <= 2) || 
                               (x <= 2 && y >= ROWS-3) || (x >= COLS-3 && y >= ROWS-3);
        
        if (positionEmpty && !tooCloseToStart) {
            gameState.walls[wallKey] = { x, y, destructible: true };
            console.log(`Spawned random block at (${x}, ${y})`);
            broadcastGameState();
            break;
        }
    }
}

// Start random block spawning with varying intervals
function scheduleNextBlockSpawn() {
    const randomDelay = Math.random() * 7000 + 8000; // Random interval between 8-15 seconds
    setTimeout(() => {
        if (Object.keys(gameState.players).length > 0) { // Only spawn if players are connected
            spawnRandomBlock();
        }
        scheduleNextBlockSpawn(); // Schedule the next spawn
    }, randomDelay);
}

// Start the spawning system
scheduleNextBlockSpawn();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});