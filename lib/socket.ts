import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';

let io: SocketIOServer;

export const initSocket = (server: HttpServer) => {
    io = new SocketIOServer(server);

    // Authentication Middleware
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers['authorization'];

        if (!token) {
            return next(new Error('Authentication Error: Token missing'));
        }

        const exactToken = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

        try {
            const decoded = jwt.verify(exactToken, process.env.JWT_SECRET as string) as any;

            // Attach user data to socket for later use if needed
            (socket as any).user = decoded;

            console.log(decoded)

            // ⭐️ Crucial Step: The user joins a private room named after their ID
            socket.join(decoded.userId);
            console.log(`[Socket] User ${decoded.userId} authenticated and joined their private room.`);

            next();
        } catch (err) {
            return next(new Error('Authentication Error: Invalid or expired token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log(`[Socket] Client connected: ${socket.id}`);

        socket.on('disconnect', () => {
            console.log(`[Socket] Client disconnected: ${socket.id}`);
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
