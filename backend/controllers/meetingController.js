const MeetingRequest = require('../models/MeetingRequest');
const MeetingSession = require('../models/MeetingSession');
const User = require('../models/User');

function getPeer(session, userId) {
  const isUser1 = Number(session.user1_id) === Number(userId);
  return {
    id: isUser1 ? session.user2_id : session.user1_id,
    nom: isUser1 ? session.user2_nom : session.user1_nom,
    prenom: isUser1 ? session.user2_prenom : session.user1_prenom,
    photo: isUser1 ? session.user2_photo : session.user1_photo
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
    io.to(`user:${request.sender_id}`).emit('meeting:response', { request: updated, session });
    io.to(`user:${request.receiver_id}`).emit('meeting:response', { request: updated, session });
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
      received: requests.filter((request) => Number(request.receiver_id) === Number(req.user.id)),
      sent: requests.filter((request) => Number(request.sender_id) === Number(req.user.id)),
      activeSessions: sessions.map((session) => ({
        ...session,
        peer: getPeer(session, req.user.id)
      }))
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
    return res.json({ ...session, peer: getPeer(session, req.user.id) });
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
    req.app.get('io').to(`session:${req.params.id}`).emit('meeting:ended', session);
    return res.json(session);
  } catch (error) {
    return res.status(500).json({ message: 'Erreur fin de session.', error: error.message });
  }
}

module.exports = { createRequest, respondToRequest, dashboard, getSession, endSession };
