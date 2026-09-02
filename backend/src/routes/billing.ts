import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { createPaymentOrder, getBillingStatus, recordPaymentCallback } from '../services/billing.js'
import type { SubscriptionPlan } from '../types.js'

export const billingRouter = Router()

const PAID_PLANS = new Set<SubscriptionPlan>(['personal', 'team', 'business', 'institution', 'research_enterprise'])

billingRouter.get('/status', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    res.json(await getBillingStatus(user.id))
  } catch (error) {
    next(error)
  }
})

billingRouter.post('/checkout', async (req, res, next) => {
  try {
    const user = getAuthenticatedUser(req)
    const plan = req.body?.plan as SubscriptionPlan | undefined
    const amount = Number(req.body?.amount ?? 0)
    const currency = typeof req.body?.currency === 'string' ? req.body.currency : 'USD'
    if (!plan || !PAID_PLANS.has(plan)) {
      return res.status(400).json({ error: 'A paid plan is required' })
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'amount must be a non-negative number in minor units' })
    }

    res.status(201).json(await createPaymentOrder({ userId: user.id, plan, amount, currency }))
  } catch (error) {
    next(error)
  }
})

billingRouter.post('/callback', async (req, res, next) => {
  try {
    res.json(await recordPaymentCallback(req.body && typeof req.body === 'object' ? req.body : {}))
  } catch (error) {
    next(error)
  }
})
