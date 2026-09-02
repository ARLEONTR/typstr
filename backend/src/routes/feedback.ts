import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth.js';
import { getDbPool } from '../db.js';
import { randomUUID } from 'node:crypto';

const router = Router();

router.post('/', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const { message } = req.body;
    const userId = (req.user as { id: string }).id;

    await getDbPool().query(
      'INSERT INTO feedback (id, user_id, message, created_at) VALUES ($1, $2, $3, $4)',
      [randomUUID(), userId, message, Date.now()]
    );

    res.status(201).end();
  } catch (error) {
    next(error);
  }
});

router.post('/:feedbackId/replies', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const { message } = req.body as { message?: string };
    const userId = (req.user as { id: string }).id;
    const feedbackId = req.params.feedbackId;
    const trimmed = (message ?? '').trim();

    if (!trimmed) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const rootFeedbackResult = await getDbPool().query(
      `SELECT id, parent_feedback_id
       FROM feedback
       WHERE id = $1 AND user_id = $2`,
      [feedbackId, userId],
    );

    if (rootFeedbackResult.rowCount === 0) {
      return res.status(404).json({ error: 'Feedback item not found.' });
    }

    const rootFeedbackId = rootFeedbackResult.rows[0].parent_feedback_id ?? rootFeedbackResult.rows[0].id;

    await getDbPool().query(
      'INSERT INTO feedback (id, user_id, message, parent_feedback_id, created_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), userId, trimmed, rootFeedbackId, Date.now()],
    );

    res.status(201).end();
  } catch (error) {
    next(error);
  }
});

export default router;
