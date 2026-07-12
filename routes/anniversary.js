import express from 'express';
import { adminAuth } from '../lib/socketAuth.js';

const router = express.Router();

const renderOverlay = (res, mode) => {
  res.render('anniversary_overlay', { mode });
};

router.get('/overlay', (req, res) => {
  renderOverlay(res, 'overlay');
});

router.get('/wheel', (req, res) => {
  renderOverlay(res, 'wheel');
});

router.get('/leaderboard', (req, res) => {
  renderOverlay(res, 'leaderboard');
});

router.get('/admin', adminAuth(), (req, res) => {
  res.render('anniversary_admin');
});

export default router;
