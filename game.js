class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = null;
        
        // Game constants
        this.CELL_SIZE = 32;
        this.COLS = Math.floor(this.canvas.width / this.CELL_SIZE);
        this.ROWS = Math.floor(this.canvas.height / this.CELL_SIZE) + 1; // Add 1 to fill unused space
        
        // Game state
        this.players = {};
        this.bombs = {};
        this.explosions = {};
        this.walls = {};
        this.powerups = {};
        this.fireTrails = {};
        this.playerId = null;
        
        // Input handling
        this.keys = {};
        this.continuousMovement = null; // Interval for continuous movement
        this.lastMoveTime = 0;
        this.moveDelay = 80; // ms between moves when holding
        
        this.initializeInput();
        this.connectToServer();
        this.gameLoop();
    }
    
    initializeInput() {
        document.addEventListener('keydown', (e) => {
            if (!this.keys[e.code]) {
                this.keys[e.code] = true;
                this.handleKeyPress(e.code);
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
            this.stopContinuousMovement();
        });
        
        // Handle mouse clicks for teleport and wall building
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;
            
            // Convert canvas coordinates to grid coordinates
            const gridX = Math.floor(canvasX / this.CELL_SIZE);
            const gridY = Math.floor(canvasY / this.CELL_SIZE);
            
            const player = this.players[this.playerId];
            if (!player) return;
            
            // Check if player has teleport power-up (holding Shift to teleport)
            if (e.shiftKey && player.powerups?.teleport) {
                this.socket.emit('teleport', { x: gridX, y: gridY });
            }
            // Check if player has wall builder power-up (holding Ctrl to build wall)
            else if (e.ctrlKey && player.powerups?.wall_builder) {
                this.socket.emit('buildWall', { x: gridX, y: gridY });
            }
        });
    }
    
    handleKeyPress(keyCode) {
        // Move immediately on key press
        this.processMovement(keyCode);
        
        // Start continuous movement after delay
        setTimeout(() => {
            if (this.keys[keyCode]) { // Still pressed after delay
                this.startContinuousMovement(keyCode);
            }
        }, 200);
    }
    
    processMovement(keyCode) {
        const player = this.players[this.playerId];
        if (!player || !this.socket) return;
        
        let newX = player.x;
        let newY = player.y;
        let moved = false;
        
        if (keyCode === 'KeyW' || keyCode === 'ArrowUp') {
            newY = player.y - 1; // Let server handle wrap-around
            moved = true;
        } else if (keyCode === 'KeyS' || keyCode === 'ArrowDown') {
            newY = player.y + 1; // Let server handle wrap-around
            moved = true;
        } else if (keyCode === 'KeyA' || keyCode === 'ArrowLeft') {
            newX = player.x - 1; // Let server handle wrap-around
            moved = true;
        } else if (keyCode === 'KeyD' || keyCode === 'ArrowRight') {
            newX = player.x + 1; // Let server handle wrap-around
            moved = true;
        } else if (keyCode === 'Space') {
            this.socket.emit('placeBomb', { x: player.x, y: player.y });
            return;
        }
        
        if (moved) {
            this.socket.emit('move', { x: newX, y: newY });
            this.lastMoveTime = Date.now();
        }
    }
    
    startContinuousMovement(keyCode) {
        this.stopContinuousMovement(); // Clear any existing interval
        
        this.continuousMovement = setInterval(() => {
            if (this.keys[keyCode]) {
                this.processMovement(keyCode);
            } else {
                this.stopContinuousMovement();
            }
        }, this.moveDelay);
    }
    
    stopContinuousMovement() {
        if (this.continuousMovement) {
            clearInterval(this.continuousMovement);
            this.continuousMovement = null;
        }
    }
    
    connectToServer() {
        this.socket = io();
        
        // Get or create persistent player ID (use sessionStorage so each tab is a different player)
        let persistentPlayerId = sessionStorage.getItem('bombermanPlayerId');
        if (!persistentPlayerId) {
            persistentPlayerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('bombermanPlayerId', persistentPlayerId);
        }
        
        // Handle connection
        this.socket.on('connect', () => {
            console.log('Connected to server');
            // Send persistent ID to server
            this.socket.emit('setPlayerId', { persistentId: persistentPlayerId });
        });
        
        // Receive initial game state
        this.socket.on('init', (data) => {
            this.playerId = data.playerId;
            this.players = data.gameState.players;
            this.bombs = data.gameState.bombs;
            this.explosions = data.gameState.explosions;
            this.walls = data.gameState.walls;
            this.powerups = data.gameState.powerups || {};
            this.fireTrails = data.gameState.fireTrails || {};
            
            document.getElementById('playerCount').textContent = Object.keys(this.players).length;
            this.updateLivesDisplay();
        });
        
        // Receive game state updates
        this.socket.on('gameState', (data) => {
            this.players = data.players;
            this.bombs = data.bombs;
            this.explosions = data.explosions;
            this.walls = data.walls;
            this.powerups = data.powerups || {};
            this.fireTrails = data.fireTrails || {};
            
            document.getElementById('playerCount').textContent = Object.keys(this.players).length;
            this.updateLivesDisplay();
        });
        
        // Handle disconnection
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
    }
    
    getPowerupDefinition(type) {
        const definitions = {
            'mega_bomb': { emoji: '💥', color: '#FF6B35', name: 'Mega Bomb' },
            'tornado_bomb': { emoji: '🌪️', color: '#4ECDC4', name: 'Tornado Bomb' },
            'fire_trail': { emoji: '🔥', color: '#FF4757', name: 'Fire Trail' },
            'ghost_mode': { emoji: '👻', color: '#E0E0E0', name: 'Ghost Mode' },
            'teleport': { emoji: '🌀', color: '#9B59B6', name: 'Teleport' },
            'extra_life': { emoji: '💖', color: '#E74C3C', name: 'Extra Life' },
            'force_field': { emoji: '🛡️', color: '#3498DB', name: 'Force Field' },
            'swap': { emoji: '🔄', color: '#F39C12', name: 'Swap' },
            'scramble': { emoji: '🎲', color: '#8E44AD', name: 'Scramble' },
            'magnet': { emoji: '🧲', color: '#E67E22', name: 'Magnet' },
            'wall_builder': { emoji: '🧱', color: '#95A5A6', name: 'Wall Builder' }
        };
        return definitions[type];
    }
    
    updateLivesDisplay() {
        const livesContainer = document.getElementById('playersLives');
        livesContainer.innerHTML = '';
        
        Object.values(this.players).forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-lives';
            
            // Player color indicator
            const colorDiv = document.createElement('div');
            colorDiv.className = 'player-color';
            colorDiv.style.backgroundColor = player.color;
            
            // Hearts display
            const heartsDiv = document.createElement('div');
            heartsDiv.className = 'hearts';
            
            for (let i = 0; i < player.lives; i++) {
                const heart = document.createElement('span');
                heart.className = 'heart';
                heart.textContent = '❤️';
                heartsDiv.appendChild(heart);
            }
            
            // Show empty hearts for lost lives
            for (let i = player.lives; i < 5; i++) {
                const heart = document.createElement('span');
                heart.className = 'heart';
                heart.style.opacity = '0.2';
                heart.textContent = '❤️';
                heartsDiv.appendChild(heart);
            }
            
            // Show active power-ups
            const powerupsDiv = document.createElement('div');
            powerupsDiv.className = 'powerups';
            
            if (player.powerups && Object.keys(player.powerups).length > 0) {
                Object.keys(player.powerups).forEach(powerupType => {
                    const powerupDef = this.getPowerupDefinition(powerupType);
                    if (powerupDef) {
                        const powerupSpan = document.createElement('span');
                        powerupSpan.className = 'powerup-icon';
                        powerupSpan.textContent = powerupDef.emoji;
                        powerupSpan.title = powerupDef.name;
                        powerupsDiv.appendChild(powerupSpan);
                    }
                });
            }
            
            playerDiv.appendChild(colorDiv);
            playerDiv.appendChild(heartsDiv);
            playerDiv.appendChild(powerupsDiv);
            livesContainer.appendChild(playerDiv);
        });
    }
    
    update(deltaTime) {
        // Client-side updates are minimal since server handles game logic
        // Just handle visual effects or local predictions if needed
    }
    
    render() {
        // Clear canvas
        this.ctx.fillStyle = '#333';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw grid
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1;
        for (let x = 0; x <= this.COLS; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * this.CELL_SIZE, 0);
            this.ctx.lineTo(x * this.CELL_SIZE, this.canvas.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= this.ROWS; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * this.CELL_SIZE);
            this.ctx.lineTo(this.canvas.width, y * this.CELL_SIZE);
            this.ctx.stroke();
        }
        
        // Draw walls
        Object.values(this.walls).forEach(wall => {
            this.ctx.fillStyle = wall.destructible ? '#8B4513' : '#666';
            this.ctx.fillRect(
                wall.x * this.CELL_SIZE + 2,
                wall.y * this.CELL_SIZE + 2,
                this.CELL_SIZE - 4,
                this.CELL_SIZE - 4
            );
        });
        
        // Draw fire trails (under everything)
        Object.values(this.fireTrails).forEach(trail => {
            this.ctx.fillStyle = '#FF4757';
            this.ctx.fillRect(
                trail.x * this.CELL_SIZE + 2,
                trail.y * this.CELL_SIZE + 2,
                this.CELL_SIZE - 4,
                this.CELL_SIZE - 4
            );
        });
        
        // Draw players (underneath bombs)
        Object.values(this.players).forEach(player => {
            if (!player.alive) return; // Don't draw dead players
            
            const x = player.x * this.CELL_SIZE + 4;
            const y = player.y * this.CELL_SIZE + 4;
            const size = this.CELL_SIZE - 8;
            
            // Base player color
            this.ctx.fillStyle = player.color;
            this.ctx.fillRect(x, y, size, size);
            
            // Special effects for power-ups
            if (player.powerups) {
                // Ghost mode - semi-transparent
                if (player.powerups.ghost_mode) {
                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    this.ctx.fillRect(x, y, size, size);
                }
                
                // Force field - blue glow
                if (player.powerups.force_field) {
                    this.ctx.strokeStyle = '#3498DB';
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
                }
                
                // Magnet - orange glow
                if (player.powerups.magnet) {
                    this.ctx.strokeStyle = '#E67E22';
                    this.ctx.lineWidth = 2;
                    this.ctx.setLineDash([5, 3]);
                    this.ctx.strokeRect(x - 1, y - 1, size + 2, size + 2);
                    this.ctx.setLineDash([]);
                }
            }
        });
        
        // Draw power-ups (before bombs)
        Object.values(this.powerups).forEach(powerup => {
            // Get power-up definition for colors/emojis
            const powerupDef = this.getPowerupDefinition(powerup.type);
            if (powerupDef) {
                // Draw background circle
                this.ctx.fillStyle = powerupDef.color;
                this.ctx.beginPath();
                this.ctx.arc(
                    powerup.x * this.CELL_SIZE + this.CELL_SIZE / 2,
                    powerup.y * this.CELL_SIZE + this.CELL_SIZE / 2,
                    this.CELL_SIZE / 3,
                    0,
                    2 * Math.PI
                );
                this.ctx.fill();
                
                // Draw emoji/text
                this.ctx.font = `${this.CELL_SIZE / 2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillStyle = '#FFF';
                this.ctx.fillText(
                    powerupDef.emoji,
                    powerup.x * this.CELL_SIZE + this.CELL_SIZE / 2,
                    powerup.y * this.CELL_SIZE + this.CELL_SIZE / 2
                );
            }
        });
        
        // Draw bombs (on top of players)
        Object.values(this.bombs).forEach(bomb => {
            // Different bomb visuals based on type
            if (bomb.type === 'mega') {
                this.ctx.fillStyle = '#FF6B35'; // Orange for mega bomb
            } else if (bomb.type === 'tornado') {
                this.ctx.fillStyle = '#4ECDC4'; // Teal for tornado bomb
            } else {
                this.ctx.fillStyle = '#222'; // Default black
            }
            
            this.ctx.fillRect(
                bomb.x * this.CELL_SIZE + 6,
                bomb.y * this.CELL_SIZE + 6,
                this.CELL_SIZE - 12,
                this.CELL_SIZE - 12
            );
            
            // Pulsing effect
            const pulse = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
            this.ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
            this.ctx.fillRect(
                bomb.x * this.CELL_SIZE + 8,
                bomb.y * this.CELL_SIZE + 8,
                this.CELL_SIZE - 16,
                this.CELL_SIZE - 16
            );
        });
        
        // Draw explosions (on top of everything)
        Object.values(this.explosions).forEach(explosion => {
            // Calculate fade based on age (explosions last 500ms)
            const age = Date.now() - (explosion.createdAt || Date.now());
            const maxAge = 500;
            const fadeProgress = Math.min(age / maxAge, 1);
            const alpha = 1 - fadeProgress;
            
            this.ctx.fillStyle = `rgba(255, 165, 0, ${alpha})`;
            this.ctx.fillRect(
                explosion.x * this.CELL_SIZE + 2,
                explosion.y * this.CELL_SIZE + 2,
                this.CELL_SIZE - 4,
                this.CELL_SIZE - 4
            );
        });
    }
    
    gameLoop() {
        const now = Date.now();
        const deltaTime = now - (this.lastFrameTime || now);
        this.lastFrameTime = now;
        
        this.update(deltaTime);
        this.render();
        
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Start the game when page loads
window.addEventListener('load', () => {
    new Game();
});