class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = null;
        
        // Game constants
        this.CELL_SIZE = 32;
        this.COLS = Math.floor(this.canvas.width / this.CELL_SIZE);
        this.ROWS = Math.floor(this.canvas.height / this.CELL_SIZE);
        
        // Game state
        this.players = {};
        this.bombs = {};
        this.explosions = {};
        this.walls = {};
        this.playerId = null;
        
        // Input handling
        this.keys = {};
        this.lastMoveTime = 0;
        this.moveDelay = 100; // ms between moves
        
        this.initializeInput();
        this.connectToServer();
        this.gameLoop();
    }
    
    initializeInput() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
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
    
    
    handleInput() {
        const now = Date.now();
        if (now - this.lastMoveTime < this.moveDelay) return;
        
        const player = this.players[this.playerId];
        if (!player || !this.socket) return;
        
        let moved = false;
        let newX = player.x;
        let newY = player.y;
        
        if (this.keys['KeyW'] || this.keys['ArrowUp']) {
            newY = Math.max(0, player.y - 1);
            moved = true;
        } else if (this.keys['KeyS'] || this.keys['ArrowDown']) {
            newY = Math.min(this.ROWS - 1, player.y + 1);
            moved = true;
        } else if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
            newX = Math.max(0, player.x - 1);
            moved = true;
        } else if (this.keys['KeyD'] || this.keys['ArrowRight']) {
            newX = Math.min(this.COLS - 1, player.x + 1);
            moved = true;
        }
        
        // Send movement to server (server will validate)
        if (moved) {
            this.socket.emit('move', { x: newX, y: newY });
            this.lastMoveTime = now;
        }
        
        // Place bomb
        if (this.keys['Space']) {
            this.socket.emit('placeBomb', { x: player.x, y: player.y });
            this.keys['Space'] = false; // Prevent spam
        }
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
        
        // Draw bombs
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
        
        // Draw explosions
        Object.values(this.explosions).forEach(explosion => {
            this.ctx.fillStyle = '#FFA500';
            this.ctx.fillRect(
                explosion.x * this.CELL_SIZE + 2,
                explosion.y * this.CELL_SIZE + 2,
                this.CELL_SIZE - 4,
                this.CELL_SIZE - 4
            );
        });
        
        // Draw players
        Object.values(this.players).forEach(player => {
            this.ctx.fillStyle = player.color;
            this.ctx.fillRect(
                player.x * this.CELL_SIZE + 4,
                player.y * this.CELL_SIZE + 4,
                this.CELL_SIZE - 8,
                this.CELL_SIZE - 8
            );
        });
    }
    
    gameLoop() {
        const now = Date.now();
        const deltaTime = now - (this.lastFrameTime || now);
        this.lastFrameTime = now;
        
        this.handleInput();
        this.update(deltaTime);
        this.render();
        
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Start the game when page loads
window.addEventListener('load', () => {
    new Game();
});