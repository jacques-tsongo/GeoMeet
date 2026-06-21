const express = require('express');
const auth = require('../middleware/authMiddleware');
const { searchUsers, me } = require('../controllers/userController');

const router = express.Router();

router.get('/me', auth, me);
router.get('/users/search', auth, searchUsers);

module.exports = router;
