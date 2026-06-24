const express = require('express')
const chatController = require('../controllers/chatController')
const authMiddleware = require('../middleware/authMiddleware');
const { multerMiddleware } = require('../config/cloudinaryConfig');

const router = express.Router();

//protected route
router.post('/send-message', authMiddleware, multerMiddleware, chatController.sendMessage);
router.get('/conversation', authMiddleware, chatController.getConversation);
router.get('/conversation/:conversationId/messages', authMiddleware, chatController.getMessages);

router.put('/message/read', authMiddleware, chatController.markAsRead);

router.delete('/messages/:messageId', authMiddleware, chatController.deleteMessage);


module.exports = router;