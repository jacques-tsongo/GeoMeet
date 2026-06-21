const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const meetingRoutes = require('./routes/meetings');
const attachLocationSocket = require('./sockets/locationSocket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PATCH']
  }
});

app.set('io', io);
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', meetingRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', name: 'GeoMeet' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

attachLocationSocket(io);

const port = Number(process.env.PORT || 5000);


server.listen(port, "0.0.0.0", () => {
  console.log(`GeoMeet lance sur http://localhost:${port}`);
});
