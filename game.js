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
            newY = Math.max(0, player.y - 1);
            moved = true;
        } else if (keyCode === 'KeyS' || keyCode === 'ArrowDown') {
            newY = Math.min(this.ROWS - 1, player.y + 1);
            moved = true;
        } else if (keyCode === 'KeyA' || keyCode === 'ArrowLeft') {
            newX = Math.max(0, player.x - 1);
            moved = true;
        } else if (keyCode === 'KeyD' || keyCode === 'ArrowRight') {
            newX = Math.min(this.COLS - 1, player.x + 1);
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
        
        // Handle connection
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });
        
        // Receive initial game state
        this.socket.on('init', (data) => {
            this.playerId = data.playerId;
            this.players = data.gameState.players;
            this.bombs = data.gameState.bombs;
            this.explosions = data.gameState.explosions;
            this.walls = data.gameState.walls;
            
            document.getElementById('playerCount').textContent = Object.keys(this.players).length;
        });
        
        // Receive game state updates
        this.socket.on('gameState', (data) => {
            this.players = data.players;
            this.bombs = data.bombs;
            this.explosions = data.explosions;
            this.walls = data.walls;
            
            document.getElementById('playerCount').textContent = Object.keys(this.players).length;
        });
        
        // Handle disconnection
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
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
        
        // Draw players (underneath bombs)
        Object.values(this.players).forEach(player => {
            this.ctx.fillStyle = player.color;
            this.ctx.fillRect(
                player.x * this.CELL_SIZE + 4,
                player.y * this.CELL_SIZE + 4,
                this.CELL_SIZE - 8,
                this.CELL_SIZE - 8
            );
        });
        
        // Draw bombs (on top of players)
        Object.values(this.bombs).forEach(bomb => {
            this.ctx.fillStyle = '#222';
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