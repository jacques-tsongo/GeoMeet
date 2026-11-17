const MeetingRequest = require('../models/MeetingRequest');
const MeetingSession = require('../models/MeetingSession');
const User = require('../models/User');

function meetingRoom(sessionId) {
  return `meeting_${sessionId}`;
}

function getPeer(session, userId) {
  const isUser1 = Number(session.user1_id) === Number(userId);
  return {
    id: isUser1 ? session.user2_id : session.user1_id,
    nom: isUser1 ? session.user2_nom : session.user1_nom,
    prenom: isUser1 ? session.user2_prenom : session.user1_prenom,
    photo: isUser1 ? session.user2_photo : session.user1_photo
  };
}

// Harmonise les états de la session avec une valeur calculée unique ('state').
// La structure existante utilise un booléen is_active : on le traduit en
// état lisible par le frontend pour afficher proprement le cycle de vie.
function serializeSession(session, userId) {
  return {
    ...session,
    state: session.is_active ? 'ACTIVE' : 'ENDED',
    peer: getPeer(session, userId)
  };
}

function serializeRequest(request, userId) {
  const isReceiver = Number(request.receiver_id) === Number(userId);
  return {
    ...request,
    state: request.status === 'pending' ? 'PENDING' : request.status === 'accepted' ? 'ACCEPTED' : 'REJECTED',
    peer: {
      id: isReceiver ? request.sender_id : request.receiver_id,
      nom: isReceiver ? request.sender_nom : request.receiver_nom,
      prenom: isReceiver ? request.sender_prenom : request.receiver_prenom,
      photo: isReceiver ? request.sender_photo : request.receiver_photo
    }
  };
}

async function createRequest(req, res) {
  try {
    const senderId = req.user.id;
    const { receiver_id } = req.body;
    if (!receiver_id || Number(receiver_id) === Number(senderId)) {
      return res.status(400).json({ message: 'Destinataire invalide.' });
    }

    const receiver = await User.findById(receiver_id);
    if (!receiver) {
      return res.status(404).json({ message: 'Utilisateur introuvable.' });
    }

    // Une demande est déjà en attente entre ces deux utilisateurs : on refuse
    // le doublon pour que le destinataire ne voie pas de demandes répétées.
    const existing = await MeetingRequest.findPendingBetween(senderId, receiver_id);
    if (existing) {
      return res.status(409).json({ message: 'Une demande est deja en attente avec cet utilisateur.' });
    }

    const request = await MeetingRequest.create(senderId, receiver_id);
    const io = req.app.get('io');
    io.to(`user:${receiver_id}`).emit('meeting:request', request);
    return res.status(201).json(request);
  } catch (error) {
    return res.status(500).json({ message: 'Erreur lors de la demande.', error: error.message });
  }
}

async function respondToRequest(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Statut invalide.' });
    }

    const request = await MeetingRequest.findById(id);
    if (!request || Number(request.receiver_id) !== Number(req.user.id)) {
      return res.status(404).json({ message: 'Demande introuvable.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ message: 'Cette demande a deja ete traitee.' });
    }

    const updated = await MeetingRequest.updateStatus(id, status);
    let session = null;
    if (status === 'accepted') {
      session = await MeetingSession.create(request.sender_id, request.receiver_id, request.id);
    }

    const io = req.app.get('io');
    // Informe les DEUX participants du résultat (acceptation ou refus).
    io.to(`user:${request.sender_id}`).emit('meeting:response', { request: updated, session });
    io.to(`user:${request.receiver_id}`).emit('meeting:response', { request: updated, session });

    // Lorsqu'une session démarre, on notifie explicitement les deux utilisateurs
    // afin que la carte s'ouvre automatiquement chez A et chez B.
    if (status === 'accepted' && session) {
      io.to(`user:${request.sender_id}`).emit('meeting:started', {
        session,
        peer: getPeer(session, request.sender_id)
      });
      io.to(`user:${request.receiver_id}`).emit('meeting:started', {
        session,
        peer: getPeer(session, request.receiver_id)
      });
    }
    return res.json({ request: updated, session });
  } catch (error) {
    return res.status(500).json({ message: 'Erreur lors de la reponse.', error: error.message });
  }
}

async function dashboard(req, res) {
  try {
    const [requests, sessions] = await Promise.all([
      MeetingRequest.listForUser(req.user.id),
      MeetingSession.listActiveForUser(req.user.id)
    ]);

    return res.json({
      received: requests.filter((request) => Number(request.receiver_id) === Number(req.user.id)).map((request) => serializeRequest(request, req.user.id)),
      sent: requests.filter((request) => Number(request.sender_id) === Number(req.user.id)).map((request) => serializeRequest(request, req.user.id)),
      activeSessions: sessions.map((session) => serializeSession(session, req.user.id))
    });
  } catch (error) {
    return res.status(500).json({ message: 'Erreur tableau de bord.', error: error.message });
  }
}

async function getSession(req, res) {
  try {
    const session = await MeetingSession.findById(req.params.id);
    if (!session || !session.is_active) {
      return res.status(404).json({ message: 'Session introuvable.' });
    }
    if (![session.user1_id, session.user2_id].map(Number).includes(Number(req.user.id))) {
      return res.status(403).json({ message: 'Acces refuse.' });
    }
    return res.json(serializeSession(session, req.user.id));
  } catch (error) {
    return res.status(500).json({ message: 'Erreur session.', error: error.message });
  }
}

async function endSession(req, res) {
  try {
    const session = await MeetingSession.end(req.params.id, req.user.id);
    if (!session) {
      return res.status(404).json({ message: 'Session introuvable.' });
    }
    const io = req.app.get('io');
    // Notifie la room (participants présents sur la page rencontre) ET les
    // rooms personnelles des deux utilisateurs : ainsi, même un utilisateur
    // resté sur le tableau de bord est informé immédiatement de la fin.
    io.to(meetingRoom(req.params.id)).emit('meeting:ended', session);
    io.to(`user:${session.user1_id}`).emit('meeting:ended', session);
    io.to(`user:${session.user2_id}`).emit('meeting:ended', session);
    return res.json(session);
  } catch (error) {
    return res.status(500).json({ message: 'Erreur fin de session.', error: error.message });
  }
}

module.exports = { createRequest, respondToRequest, dashboard, getSession, endSession };
