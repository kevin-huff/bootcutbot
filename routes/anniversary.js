import express from 'express';
import basicAuth from 'express-basic-auth';

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

router.get('/admin', basicAuth({
  users: { [process.env.web_user]: process.env.web_pass },
  challenge: true,
}), (req, res) => {
  res.render('anniversary_admin');
});

export default router;
