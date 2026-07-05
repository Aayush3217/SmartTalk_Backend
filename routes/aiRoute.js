const express = require('express');
const aiController = require('../controllers/aiController');
const authMiddleware = require('../middleware/authMiddleware');

const { multerMiddleware } = require('../config/cloudinaryConfig');

const router = express.Router();

// Protected route to generate AI smart replies
router.post('/smart-reply', authMiddleware, aiController.getSmartReplies);

// Protected route to chat with AI (supports optional image/file attachment)
router.post('/chat', authMiddleware, multerMiddleware, aiController.chatWithAi);

// Protected route to summarize a conversation
router.post('/chat-summary', authMiddleware, aiController.getChatSummary);

// Protected route to improve user message drafts
router.post('/improve-message', authMiddleware, aiController.improveMessage);

module.exports = router;
