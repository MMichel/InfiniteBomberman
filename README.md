# Infinite Bomberman

A multiplayer web-based Bomberman game with infinite wrap-around world and persistent lives system.

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Play the game:**
   Open `http://localhost:3000` in your browser. Open multiple tabs for multiplayer!

## 🎮 How to Play

### Controls
- **WASD** or **Arrow Keys**: Move your player
- **SPACE**: Place bomb

### Game Features

#### 🌍 Infinite World
- **No boundaries**: Walk off any edge to appear on the opposite side
- **Wrap-around explosions**: Bombs placed near edges create explosions that continue on the opposite side
- **Strategic positioning**: Use wrap-around for tactical advantages

#### 💖 Lives System
- Start with **5 lives** (shown as hearts ❤️)
- Lose 1 life when hit by explosion
- **Respawn instantly** at a safe location when lives remain
- **Eliminated** when all lives are lost
- Lives persist across browser refreshes

#### 💣 Combat
- **Bomb range**: 3 squares in each direction
- **Destructible walls**: Brown blocks can be destroyed
- **Indestructible walls**: Gray blocks stop explosions
- **Cross-world damage**: Explosions wrap around the world edges

## 🎯 Objective

Survive as long as possible while eliminating other players. Use bombs strategically to destroy walls, create paths, and eliminate opponents. The infinite world creates unique tactical opportunities!

## 🔧 Technical Features

- **Real-time multiplayer**: WebSocket-based with Socket.io
- **Persistent player state**: Lives and progress saved across reconnections
- **Responsive movement**: Event-driven input system
- **Wrap-around physics**: True infinite world mechanics

## 🌐 Multiplayer

- Each browser tab represents a different player
- Players are color-coded (red, green, blue, yellow)
- Real-time synchronization across all connected players
- Reconnection support maintains game state

---

*Built with vanilla JavaScript, Node.js, and Socket.io*