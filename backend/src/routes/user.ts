import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth.js';
import { getDbPool } from '../db.js';
import { isAdminEmail } from '../adminAccess.js';

const router = Router();

router.get('/feedback', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    // Return the user's root feedback rows AND every reply (from any author,
    // including admins) whose parent is one of those roots. We join against
    // users to surface the author email so the client can flag admin replies.
    const { rows } = await getDbPool().query(
      `SELECT f.id,
              f.message,
              f.created_at,
              f.status,
              f.admin_response,
              f.parent_feedback_id,
              u.email AS author_email
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       WHERE f.user_id = $1
          OR f.parent_feedback_id IN (SELECT id FROM feedback WHERE user_id = $1)
       ORDER BY f.created_at DESC`,
      [userId],
    );

    const enriched = rows.map((row) => ({
      id: row.id,
      message: row.message,
      created_at: row.created_at,
      status: row.status,
      admin_response: row.admin_response,
      parent_feedback_id: row.parent_feedback_id,
      is_admin_reply: Boolean(row.parent_feedback_id) && isAdminEmail(row.author_email),
    }));

    res.json(enriched);
  } catch (error) {
    next(error);
  }
});

export default router;
