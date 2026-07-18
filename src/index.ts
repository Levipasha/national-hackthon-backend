import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api';
import { connectDatabase, seedDatabase } from './config/db';

dotenv.config();

const app = express();

// ─── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true
}));
app.options('*', cors()); // Handle all OPTIONS preflight requests

app.use(express.json({ limit: '10mb' }));

// ─── LAZY DB CONNECTION ────────────────────────────────────────────────────
// Vercel serverless functions are stateless: connect on first request
let dbConnected = false;
app.use(async (req, res, next) => {
  if (!dbConnected) {
    try {
      await connectDatabase();
      await seedDatabase();
      dbConnected = true;
    } catch (err) {
      console.error('[DB] Connection failed:', err);
      return res.status(500).json({ message: 'Database connection error' });
    }
  }
  next();
});

// ─── API ROUTES ────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// Health check
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'CodeSprint-2026 API running', status: 'OK' });
});

// ─── SOCKET.IO (local dev only) ────────────────────────────────────────────
// Socket.IO doesn't work on Vercel serverless. It only runs locally.
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true
    }
  });

  app.set('io', io);

  io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);

    socket.on('join_user_room', (userId: string) => {
      socket.join(userId);
    });

    socket.on('join_team_room', (teamId: string) => {
      socket.join(teamId);
    });

    socket.on('new_join_request', (data: { leaderId: string; teamId: string; requesterName: string }) => {
      socket.to(data.leaderId).emit('join_request_received', {
        teamId: data.teamId,
        message: `${data.requesterName} has requested to join your team.`
      });
    });

    socket.on('request_response', (data: { userId: string; teamId: string; status: 'approved' | 'rejected' }) => {
      socket.to(data.userId).emit('request_response_received', {
        teamId: data.teamId,
        status: data.status,
        message: data.status === 'approved'
          ? 'Your request to join the team has been approved!'
          : 'Your request to join the team was declined.'
      });
      if (data.status === 'approved') {
        io.to(data.teamId).emit('team_updated');
      }
    });

    socket.on('team_modified', (teamId: string) => {
      io.to(teamId).emit('team_updated');
    });

    socket.on('admin_broadcast', (data: { targetType: string; targetId?: string; title: string; message: string }) => {
      io.emit('broadcast_received', data);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.id}`);
    });
  });

  server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
  });
} else {
  // On Vercel (production), store a mock io so routes don't crash when calling req.app.get('io')
  const mockIo = {
    to: () => ({ emit: () => {} }),
    emit: () => {}
  };
  app.set('io', mockIo);
}

export default app;
