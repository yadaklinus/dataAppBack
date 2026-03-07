const { io } = require("socket.io-client");

console.log("\n=================================");
console.log("   Mutfi Pay Socket.js Tester  ");
console.log("=================================\n");

const socket = io("http://localhost:3008/test", {
    transports: ["websocket", "polling"]
});

console.log("Attempting to connect to http://localhost:3008/test ...");

socket.on("connect", () => {
    console.log("✅ CONNECTED SUCCESSFULLY! Socket ID:", socket.id);
    console.log("🚀 Sending ping event to server...");
    socket.emit("ping");
});

socket.on("welcome", (data) => {
    console.log("📩 Received 'welcome' event:", data);
});

socket.on("pong", (data) => {
    console.log("🏓 Received 'pong' event:", data);
    console.log("\n✅ Socket.io is fully operational.");
    console.log("Exiting test.");
    process.exit(0);
});

socket.on("connect_error", (err) => {
    console.log("❌ Connection Error:", err.message);
    process.exit(1);
});

// Failsafe timeout
setTimeout(() => {
    console.log("⚠️  Connection timed out after 10 seconds.");
    process.exit(1);
}, 10000);
