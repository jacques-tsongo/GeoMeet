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

// ---------------------------------------------------------------------------
// MIGRATION HTML -> EJS :
// Express rend desormais les pages via le moteur de templates EJS.
// Les vues sont dans le dossier /views, les fichiers statiques dans /public.
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* --------------------------------------------------------------------------
   CORS : le frontend et le backend sont maintenant servis par le MEME serveur
   (Render en production, localhost en dev), donc les requetes navigateur sont
   same-origin et n'ont pas besoin de CORS. On garde une configuration ouverte
   (sans credentials, qui evite la combinaison invalide origin:'*' + credentials)
   pour ne jamais bloquer les cas cross-origin restants.
-------------------------------------------------------------------------- */
app.use(cors());

app.use(express.json());

const server = http.createServer(app);

/* --------------------------------------------------------------------------
   Socket.IO : meme origine que le frontend (config adaptee local + Render).
   Aucun credentials cookie utilise (auth JWT dans le handshake), donc une
   politique d'origine reflechie est valide.
-------------------------------------------------------------------------- */
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST', 'PATCH']
  }
});

app.set('io', io);

// ---------------------------------------------------------------------------
// ROUTES DES PAGES (rendues avec EJS)
// ---------------------------------------------------------------------------
// Page d'accueil : veritable page EJS, pas une redirection vers login.
app.get('/', (req, res) => {
  res.render('index');
});

// Page de connexion
app.get('/login', (req, res) => {
  res.render('login');
});

// Page d'inscription
app.get('/register', (req, res) => {
  res.render('register');
});

// Tableau de bord (la protection est geree cote client, comme avant migration)
app.get('/dashboard', (req, res) => {
  res.render('dashboard');
});

// Page de rencontre creee autour d'une session (parametre ?session= en query)
app.get('/meeting', (req, res) => {
  res.render('meeting');
});

// ---------------------------------------------------------------------------
// ROUTES API (inchangees, uniquement desormais servies par le meme serveur)
// ---------------------------------------------------------------------------
app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', meetingRoutes);

// Healthcheck (inchange)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', name: 'GeoMeet' });
});

// ---------------------------------------------------------------------------
// Page 404 - placee APRES toutes les routes API et pages pour ne rien casser
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

// ---------------------------------------------------------------------------
// Socket.IO : partage de localisation temps reel (inchange)
// ---------------------------------------------------------------------------
attachLocationSocket(io);

// ---------------------------------------------------------------------------
// Port : process.env.PORT pour Render, 5000 par defaut en local
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT || 5000);

// Ecoute sur 0.0.0.0 pour que Render puisse router les requetes
server.listen(port, '0.0.0.0', () => {
  console.log(`GeoMeet lance sur le port ${port}`);
});