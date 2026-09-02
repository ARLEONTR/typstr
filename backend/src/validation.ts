type StringOk = { valid: true; value: string }
type Fail = { valid: false; error: string }

export function validateString(
  value: unknown,
  opts: { maxLength: number; required?: boolean; label?: string }
): StringOk | Fail {
  const label = opts.label ?? 'Value'

  if (typeof value !== 'string' || !value.trim()) {
    if (opts.required) return { valid: false, error: `${label} is required` }
    return { valid: true, value: '' }
  }

  const trimmed = value.trim()
  if (trimmed.length > opts.maxLength) {
    return { valid: false, error: `${label} must be at most ${opts.maxLength} characters` }
  }

  return { valid: true, value: trimmed }
}

export function validateEmail(value: unknown): StringOk | Fail {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, error: 'Email is required' }
  }

  const trimmed = value.trim().toLowerCase()

  if (trimmed.length > 254) {
    return { valid: false, error: 'Email must be at most 254 characters' }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { valid: false, error: 'Invalid email format' }
  }

  return { valid: true, value: trimmed }
}

export function validateArrayLength(
  value: unknown,
  opts: { maxItems: number; label?: string }
): { valid: true } | Fail {
  const label = opts.label ?? 'Array'

  if (!Array.isArray(value)) {
    return { valid: false, error: `${label} must be an array` }
  }

  if (value.length > opts.maxItems) {
    return { valid: false, error: `${label} must have at most ${opts.maxItems} items` }
  }

  return { valid: true }
}

/** Validate an optional string — returns null if absent/empty, validated string otherwise */
export function validateOptionalString(
  value: unknown,
  opts: { maxLength: number; label?: string }
): { valid: true; value: string | null } | Fail {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return { valid: true, value: null }
  }

  const result = validateString(value, { ...opts, required: true })
  if (!result.valid) return result
  return { valid: true, value: result.value }
}
