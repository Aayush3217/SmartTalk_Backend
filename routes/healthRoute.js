const healthController = require('../controllers/healthController');

const express = require('express');

const router = express.Router();

router.get('/', healthController.getHealth);

module.exports = router;