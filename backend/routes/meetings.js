const express = require('express');
const auth = require('../middleware/authMiddleware');
const {
  createRequest,
  respondToRequest,
  dashboard,
  getSession,
  endSession
} = require('../controllers/meetingController');

const router = express.Router();

router.get('/meetings/dashboard', auth, dashboard);
router.post('/meetings/request', auth, createRequest);
router.patch('/meetings/request/:id', auth, respondToRequest);
router.get('/meetings/session/:id', auth, getSession);
router.patch('/meetings/session/:id/end', auth, endSession);

module.exports = router;
