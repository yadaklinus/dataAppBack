import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';

let io: SocketIOServer;

export const initSocket = (server: HttpServer) => {
    // Configure CORS so external test scripts can connect
    io = new SocketIOServer(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // -------------------------------------------------------------
    // Test Namespace (No Auth Required - Super simple connection)
    // -------------------------------------------------------------
    io.of('/test').on('connection', (socket: Socket) => {
        console.log(`[Socket.io Test] Client connected to /test namespace: ${socket.id}`);

        // Immediately emit a simple welcome event
        socket.emit('welcome', { message: 'Hello from Mufti Pay Socket.io Test Namespace!' });

        // Listen for 'ping' and respond with 'pong'
        socket.on('ping', () => {
            console.log(`[Socket.io Test] Received ping from ${socket.id}`);
            socket.emit('pong', { message: 'Pong from server!', timestamp: new Date() });
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket.io Test] Client disconnected from /test: ${socket.id} (Reason: ${reason})`);
        });
    });

    // -------------------------------------------------------------
    // Main Global Namespace (Requires Auth for standard app logic)
    // -------------------------------------------------------------
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers['authorization'];

        if (!token) {
            return next(new Error('Authentication Error: Token missing'));
        }

        const exactToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

        try {
            const decoded = jwt.verify(exactToken, process.env.JWT_SECRET as string) as any;

            // Attach user data to socket for later use
            (socket as any).user = decoded;

            // The user joins a private room named after their ID
            socket.join(decoded.userId);
            console.log(`[Socket] User ${decoded.userId} authenticated and joined their private room.`);

            next();
        } catch (err) {
            return next(new Error('Authentication Error: Invalid or expired token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log(`[Socket] Authenticated App Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`[Socket] Authenticated App Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

// Getter method to use the io instance in controllers
export const getIO = (): SocketIOServer => {
    if (!io) {
        throw new Error('Socket.io has not been initialized. Call initSocket() first.');
    }
    return io;
};
