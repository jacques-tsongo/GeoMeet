const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function register(req, res) {
  try {
    const { nom, prenom, email, telephone, password, confirmPassword, photo } = req.body;
    if (!nom || !prenom || !email || !telephone || !password || !confirmPassword) {
      return res.status(400).json({ message: 'Tous les champs obligatoires doivent etre remplis.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Les mots de passe ne correspondent pas.' });
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'Cet email est deja utilise.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({ nom, prenom, email, telephone, password: hash, photo });
    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    return res.status(500).json({ message: 'Erreur lors de l inscription.', error: error.message });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }

    const userWithPassword = await User.findByEmail(email);
    if (!userWithPassword) {
      return res.status(401).json({ message: 'Identifiants invalides.' });
    }

    const validPassword = await bcrypt.compare(password, userWithPassword.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Identifiants invalides.' });
    }

    const user = await User.findById(userWithPassword.id);
    const token = signToken(user);
    return res.json({ token, user });
  } catch (error) {
    return res.status(500).json({ message: 'Erreur lors de la connexion.', error: error.message });
  }
}

module.exports = { register, login };
